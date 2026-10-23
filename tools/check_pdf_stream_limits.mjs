// Exercise the shipped worker, with small quotas so bomb regressions stay cheap.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { brotliCompressSync, deflateSync } from 'node:zlib';

const source = await readFile('src/vendor/pdfjs/build/pdf.worker.min.mjs', 'utf8');
function worker({ streamLimit = 64 * 1024, documentLimit = 256 * 1024,
  decompressor = class { constructor() { throw new Error("Native decoding must not run"); } } } = {}) {
  const script = source.slice(0, source.lastIndexOf('export{'))
    .replaceAll('import.meta.url', '"file:///pdf.worker.mjs"')
    .replace('const MAX_DECODED_STREAM_BYTES = 64 * 1024 * 1024;',
      `const MAX_DECODED_STREAM_BYTES = ${streamLimit};`)
    .replace('const MAX_DOCUMENT_DECODE_BYTES = 256 * 1024 * 1024;',
      `const MAX_DOCUMENT_DECODE_BYTES = ${documentLimit};`);
  return runInNewContext(script + `
    ({ DecodeStream, Stream, FlateStream, BrotliStream, Parser, Lexer, Dict, Name,
       XRef, LocalPdfManager, DecodedStreamLimitError })`, {
    console, DecompressionStream: decompressor, TextDecoder, TextEncoder,
    setTimeout, clearTimeout,
  });
}
function documentContext(core) {
  const xref = new core.XRef(new core.Stream(new Uint8Array()), {});
  return { xref, dict: new core.Dict(xref) };
}
function decode(core, bytes, dict, Decoder = core.FlateStream) {
  return new Decoder(new core.Stream(bytes, 0, bytes.length, dict), bytes.length);
}
const limitError = (core) => (error) => error instanceof core.DecodedStreamLimitError;
async function asyncBytes(stream) {
  const bytes = await stream.asyncGetBytes();
  return bytes || stream.getBytes();
}

function pdfWithContents(contents, filters) {
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100]
      /Contents [${contents.map((_, i) => `${i + 4} 0 R`).join(' ')}] >>`),
  ];
  // Each content stream can carry the same nested filter array.
  for (const content of contents) {
    objects.push(Buffer.concat([Buffer.from(`<< /Length ${content.length}
      /Filter [${filters.map((filter) => `/${filter}`).join(' ')}] >>\nstream\n`),
    content, Buffer.from('\nendstream')]));
  }
  let pdf = Buffer.from('%PDF-1.7\n');
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf = Buffer.concat([pdf, Buffer.from(`${i + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]);
  }
  return Buffer.concat([pdf, Buffer.from(`xref\n0 ${offsets.length}\n0000000000 65535 f \n` +
    offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${pdf.length}\n%%EOF\n`)]);
}
async function contentStream(core, bytes) {
  const manager = new core.LocalPdfManager({ source: bytes, docId: 'synthetic',
    evaluatorOptions: {}, handler: { send() {} } });
  await manager.initDocument(false);
  return (await manager.getPage(0)).getContentStream();
}

// Requests, rounded capacity and attacker-controlled length hints are checked
// before allocation. Reusing a buffer costs nothing; growth counts both copies.
{
  const core = worker({ streamLimit: 1024, documentLimit: 4096 });
  const stream = new core.DecodeStream(2 ** 40);
  assert.equal(stream.ensureBuffer(1).length, 1024);
  assert.equal(stream.ensureBuffer(1024), stream.buffer);
  assert.equal(stream.decodedStreamBudget.allocated, 1024);
  const previous = stream.buffer;
  assert.throws(() => stream.ensureBuffer(1025), limitError(core));
  assert.equal(stream.buffer, previous);
  // A caught limit error cannot reset the quota or resume allocating.
  assert.throws(() => stream.ensureBuffer(1), limitError(core));
  for (const length of [Infinity, NaN, -1, 1.5]) {
    assert.throws(() => new core.DecodeStream().ensureBuffer(length), limitError(core));
  }
  const growing = new core.DecodeStream();
  growing.ensureBuffer(1);
  growing.ensureBuffer(513);
  assert.equal(growing.decodedStreamBudget.allocated, 512 + 1024);
}

// Distinct streams and filter layers share the document quota. A new document
// has a fresh quota even when the same worker is reused across reloads.
{
  const core = worker({ documentLimit: 1024 });
  const { dict, xref } = documentContext(core);
  for (let i = 0; i < 2; i++) {
    const stream = new core.DecodeStream();
    stream.dict = dict;
    stream.ensureBuffer(512);
  }
  const third = new core.DecodeStream();
  third.dict = dict;
  assert.throws(() => third.ensureBuffer(1), limitError(core));
  assert.equal(xref.decodedStreamBudget.allocated, 1024);
  const fresh = new core.DecodeStream();
  fresh.dict = documentContext(core).dict;
  assert.equal(fresh.ensureBuffer(512).length, 512);
}

// Real compression must be bounded through both synchronous and async callers.
// The native API must not run, even when it is available in the webview.
for (const [decoderName, compress] of [
  ['FlateStream', deflateSync], ['BrotliStream', brotliCompressSync],
]) {
  let nativeCalls = 0;
  const core = worker({ decompressor: class {
    constructor() { nativeCalls++; throw new Error('Unbounded native allocation'); }
  } });
  const small = Buffer.from('q 0 0 1 rg 0 0 10 10 re f Q\n');
  const encoded = compress(small);
  const sync = decode(core, encoded, documentContext(core).dict, core[decoderName]);
  assert.deepEqual(Buffer.from(sync.getBytes()), small);
  const native = decode(core, encoded, documentContext(core).dict, core[decoderName]);
  assert.deepEqual(Buffer.from(await asyncBytes(native)), small);

  const bomb = compress(Buffer.alloc(128 * 1024, 32));
  assert.ok(bomb.length < 1024);
  const syncBomb = decode(core, bomb, documentContext(core).dict, core[decoderName]);
  assert.throws(() => syncBomb.getBytes(), limitError(core));
  const nativeBomb = decode(core, bomb, documentContext(core).dict, core[decoderName]);
  await assert.rejects(asyncBytes(nativeBomb), limitError(core));
  assert.equal(nativeCalls, 0);
}

// Concurrent streams consume the same cumulative document quota. Software
// Brotli must account for output chunks and their joined copy as well as history.
{
  const core = worker({ documentLimit: 768 });
  const { dict, xref } = documentContext(core);
  const encoded = deflateSync(Buffer.alloc(512));
  assert.equal((await asyncBytes(decode(core, encoded, dict))).length, 512);
  assert.equal(xref.decodedStreamBudget.allocated, 512);
  const results = await Promise.allSettled([
    asyncBytes(decode(core, encoded, dict)), asyncBytes(decode(core, encoded, dict)),
  ]);
  assert.ok(results.every((result) => result.status === 'rejected' && limitError(core)(result.reason)));
  assert.ok(xref.decodedStreamBudget.allocated <= 768);

  const brotli = worker();
  const context = documentContext(brotli);
  const bytes = Buffer.alloc(20 * 1024, 32);
  const stream = decode(brotli, brotliCompressSync(bytes), context.dict, brotli.BrotliStream);
  assert.equal(stream.getBytes().length, bytes.length);
  assert.ok(context.xref.decodedStreamBudget.allocated >= 2 * 16384 + bytes.length,
    'Brotli chunks and joined output must both count.');
  const lowQuota = worker({ documentLimit: 16384 });
  assert.throws(() => decode(lowQuota, brotliCompressSync(bytes),
    documentContext(lowQuota).dict, lowQuota.BrotliStream).getBytes(), limitError(lowQuota));
}

// Use the actual parser's attacker-controlled filter arrays. Both nested Flate
// output and an oversized intermediate whose final output is tiny are bounded.
{
  const core = worker();
  function filtered(bytes, filters) {
    const { dict, xref } = documentContext(core);
    dict.set('Filter', filters.map((filter) => core.Name.get(filter)));
    const parser = new core.Parser({ lexer: new core.Lexer(new core.Stream(new Uint8Array())), xref });
    return parser.filter(
      new core.Stream(bytes, 0, bytes.length, dict), dict, bytes.length);
  }
  const filters = ['FlateDecode', 'FlateDecode'];
  const small = deflateSync(deflateSync(Buffer.from('q Q')));
  assert.equal(new TextDecoder().decode(filtered(small, filters).getBytes()), 'q Q');
  assert.equal(new TextDecoder().decode(await asyncBytes(filtered(small, filters))), 'q Q');
  const bomb = deflateSync(deflateSync(Buffer.alloc(128 * 1024, 32)));
  assert.throws(() => filtered(bomb, filters).getBytes(), limitError(core));
  await assert.rejects(asyncBytes(filtered(bomb, filters)), limitError(core));
  // ASCIIHex would discard all whitespace, but its Flate input must still fit.
  const intermediate = filtered(deflateSync(Buffer.alloc(128 * 1024, 32)),
    ['FlateDecode', 'ASCIIHexDecode']);
  assert.throws(() => intermediate.getBytes(), limitError(core));
  for (const image of ['DCTDecode', 'JPXDecode', 'JBIG2Decode', 'CCITTFaxDecode']) {
    // No image decode should occur while constructing the filter chain.
    assert.throws(() => filtered(Buffer.from([1, 2]), [image, 'FlateDecode']),
      /Image filters must be the final decoding layer/);
    assert.equal(filtered(Buffer.from([1, 2]), [image]).isImageStream, true);
  }
}

// Follow actual PDF bytes through document parsing and page-content assembly.
// No large PDF or allocation is needed to demonstrate the expansion boundary.
{
  const core = worker();
  const filters = ['FlateDecode', 'FlateDecode'];
  const small = pdfWithContents([deflateSync(deflateSync(Buffer.from('q Q')))], filters);
  assert.equal(new TextDecoder().decode((await contentStream(core, small)).getBytes()), 'q Q');
  const bomb = pdfWithContents([deflateSync(deflateSync(Buffer.alloc(128 * 1024, 32)))], filters);
  await assert.rejects(async () => (await contentStream(core, bomb)).getBytes(), limitError(core));
  const intermediate = pdfWithContents([deflateSync(Buffer.alloc(128 * 1024, 32))],
    ['FlateDecode', 'ASCIIHexDecode']);
  await assert.rejects(async () => (await contentStream(core, intermediate)).getBytes(), limitError(core));

  const quota = worker({ documentLimit: 2400 });
  const separate = pdfWithContents([
    deflateSync(Buffer.alloc(512, 32)), deflateSync(Buffer.alloc(512, 32)),
  ], ['FlateDecode']);
  await assert.rejects(async () => (await contentStream(quota, separate)).getBytes(), limitError(quota));
}

// Existing PDFs still load and expose their page content through PDFDocument.
{
  const core = worker({ streamLimit: 64 * 1024 * 1024, documentLimit: 256 * 1024 * 1024 });
  const oversized = new core.DecodeStream();
  assert.throws(() => oversized.ensureBuffer(64 * 1024 * 1024 + 1), limitError(core));
  assert.equal(oversized.buffer.byteLength, 0, 'The production cap must reject before allocation.');
  for (const fixture of ['hello.pdf', 'three-pages.pdf', 'dense-page.pdf', 'jpeg2000.pdf', 'jbig2.pdf']) {
    const manager = new core.LocalPdfManager({
      source: await readFile(`tests/fixtures/${fixture}`), docId: fixture,
      evaluatorOptions: {}, handler: { send() {} },
    });
    await manager.initDocument(false);
    for (let i = 0; i < manager.pdfDocument.numPages; i++) {
      const page = await manager.getPage(i);
      const stream = await page.getContentStream();
      assert.ok(stream.getBytes().length > 0, `${fixture} page ${i + 1}`);
    }
    manager.terminate();
  }
}
console.log('PDF stream decoding limits passed.');
