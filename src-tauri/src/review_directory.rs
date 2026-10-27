//! Review paths retain the directory authorized when the document was admitted.
//! Transactions use relative leaves, or the handle's locked physical Windows path.

use cap_std::fs::{Dir, Metadata, OpenOptions};
use std::collections::HashMap;
use std::ops::Deref;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::{fs, io};

#[derive(Clone, Default)]
pub(crate) struct AllowedDocuments(HashMap<PathBuf, Option<ReviewPath>>);

impl AllowedDocuments {
    pub(crate) fn insert(&mut self, path: PathBuf) -> Result<(), String> {
        // Activating an existing tab admits its pathname again. Keep the first
        // directory identity for the session, even if that pathname was replaced.
        if self.0.contains_key(&path) {
            return Ok(());
        }
        let admitted = if matches!(super::kind_for(&path), "pdf" | "markdown") {
            let admitted = ReviewPath::new(path.clone())?;
            if !admitted
                .metadata()
                .map_err(|error| error.to_string())?
                .is_file()
            {
                return Err("document is not a regular file".into());
            }
            Some(admitted)
        } else {
            None
        };
        self.0.insert(path, admitted);
        Ok(())
    }

    pub(crate) fn contains(&self, path: &Path) -> bool {
        self.0.contains_key(path)
    }

    pub(crate) fn get(&self, path: &Path) -> Option<&ReviewPath> {
        self.0.get(path).and_then(Option::as_ref)
    }
}

#[derive(Clone)]
pub(crate) struct ReviewPath {
    path: PathBuf,
    dir: Arc<Dir>,
    #[cfg(windows)]
    physical_parent: Arc<PathBuf>,
}

impl ReviewPath {
    pub(crate) fn new(path: PathBuf) -> Result<Self, String> {
        if path.file_name().is_none() {
            return Err("could not read the file name".into());
        }
        let parent = path
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        let dir = Dir::open_ambient_dir(parent, cap_std::ambient_authority())
            .map_err(|error| error.to_string())?;
        #[cfg(windows)]
        let physical_parent =
            Arc::new(physical_directory(&dir).map_err(|error| error.to_string())?);
        Ok(Self {
            path,
            dir: Arc::new(dir),
            #[cfg(windows)]
            physical_parent,
        })
    }

    fn name(&self) -> &std::ffi::OsStr {
        self.path
            .file_name()
            .expect("review paths have a file name")
    }

    pub(crate) fn file_name_string(&self) -> String {
        self.name().to_string_lossy().into_owned()
    }

    pub(crate) fn sibling(&self, name: impl AsRef<std::ffi::OsStr>) -> Self {
        Self {
            path: self.path.with_file_name(name),
            dir: self.dir.clone(),
            #[cfg(windows)]
            physical_parent: self.physical_parent.clone(),
        }
    }

    pub(crate) fn sidecar(&self) -> Self {
        self.sibling(super::review_sidecar(&self.path).file_name().unwrap())
    }

    pub(crate) fn with_extension(&self, extension: impl AsRef<std::ffi::OsStr>) -> Self {
        self.sibling(self.path.with_extension(extension).file_name().unwrap())
    }

    pub(crate) fn open(&self) -> io::Result<fs::File> {
        self.dir.open(self.name()).map(|file| file.into_std())
    }

    pub(crate) fn open_with(&self, options: &OpenOptions) -> io::Result<fs::File> {
        self.dir
            .open_with(self.name(), options)
            .map(|file| file.into_std())
    }

    pub(crate) fn metadata(&self) -> io::Result<Metadata> {
        self.dir.metadata(self.name())
    }

    pub(crate) fn exists(&self) -> bool {
        self.dir.exists(self.name())
    }

    pub(crate) fn is_file(&self) -> bool {
        self.dir.is_file(self.name())
    }

    pub(crate) fn read_to_string(&self) -> io::Result<String> {
        self.dir.read_to_string(self.name())
    }

    #[cfg(not(windows))]
    pub(crate) fn write_atomic(&self, bytes: &[u8]) -> io::Result<()> {
        use std::io::Write;

        let mut options = OpenOptions::new();
        options.read(true).write(true).create_new(true);
        #[cfg(unix)]
        {
            use cap_std::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        // Builder supplies random names and collision retries. Creation and
        // cleanup must use the retained directory, never its stored pathname.
        let file = tempfile::Builder::new()
            .disable_cleanup(true)
            .make_in(self.path.parent().unwrap_or(Path::new(".")), |path| {
                self.dir.open_with(path.file_name().unwrap(), &options)
            })?;
        let mut temp = RelativeTempFile {
            file,
            dir: &self.dir,
        };
        if let Ok(metadata) = self.metadata() {
            temp.file
                .as_file()
                .set_permissions(metadata.permissions())?;
        }
        temp.file.write_all(bytes)?;
        temp.file.as_file().sync_all()?;
        self.dir.rename(temp.name(), &self.dir, self.name())
    }

    #[cfg(windows)]
    pub(crate) fn write_atomic(&self, bytes: &[u8]) -> io::Result<()> {
        use std::io::Write;

        // cap-std opens directories without FILE_SHARE_DELETE, keeping this
        // physical path stable. Obtain it from the handle, not the admitted
        // pathname, which may have been substituted before the directory opened.
        // Keep the verbatim prefix so UNC paths work with std::fs::rename.
        let mut temp = tempfile::NamedTempFile::new_in(&*self.physical_parent)?;
        if let Ok(metadata) = self.metadata() {
            temp.as_file()
                .set_permissions(metadata.permissions().into_std(temp.as_file())?)?;
        }
        temp.write_all(bytes)?;
        temp.as_file().sync_all()?;
        let temp = temp.into_temp_path();
        fs::rename(&temp, self.physical_parent.join(self.name()))
    }
}

// The original pathname is used only for names, kinds, and display. Filesystem
// access in review transactions uses the methods above and the retained Dir.
impl Deref for ReviewPath {
    type Target = Path;

    fn deref(&self) -> &Path {
        &self.path
    }
}

#[cfg(windows)]
fn physical_directory(dir: &Dir) -> io::Result<PathBuf> {
    use std::ffi::OsString;
    use std::os::windows::{ffi::OsStringExt, io::AsRawHandle};
    use windows_sys::Win32::Storage::FileSystem::GetFinalPathNameByHandleW;

    let mut buffer = vec![0u16; 512];
    loop {
        // SAFETY: dir owns the live handle and buffer has the stated capacity.
        let count = unsafe {
            GetFinalPathNameByHandleW(
                dir.as_raw_handle(),
                buffer.as_mut_ptr(),
                buffer.len() as u32,
                0,
            )
        };
        if count == 0 {
            return Err(io::Error::last_os_error());
        }
        if count as usize >= buffer.len() {
            buffer.resize(count as usize + 1, 0);
            continue;
        }
        buffer.truncate(count as usize);
        return Ok(PathBuf::from(OsString::from_wide(&buffer)));
    }
}

#[cfg(not(windows))]
struct RelativeTempFile<'dir> {
    file: tempfile::NamedTempFile<cap_std::fs::File>,
    dir: &'dir Dir,
}

#[cfg(not(windows))]
impl RelativeTempFile<'_> {
    fn name(&self) -> &std::ffi::OsStr {
        self.file.path().file_name().unwrap()
    }
}

#[cfg(not(windows))]
impl Drop for RelativeTempFile<'_> {
    fn drop(&mut self) {
        let _ = self.dir.remove_file(self.name());
    }
}
