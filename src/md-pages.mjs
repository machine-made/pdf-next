/// Page views: Continuous, Single page, Two pages.

export const PAGE_VIEWS = ['continuous', 'single', 'two'];

/// A saved or chosen value, or the kind's default when it is not on that
/// kind's menu. A PDF is already one page per sheet, so it has no continuous view.
export function validPageView(kind, value) {
  const menu = kind === 'pdf' ? PAGE_VIEWS.slice(1) : PAGE_VIEWS;
  return menu.includes(value) ? value : kind === 'pdf' ? 'single' : 'continuous';
}
