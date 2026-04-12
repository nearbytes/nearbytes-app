export const STUDIO_PAGES = [
  'overview',
  'moodboard',
  'palette',
  'styles',
  'graph',
  'desktop',
  'phone',
] as const;

export type StudioPage = (typeof STUDIO_PAGES)[number];

export const STUDIO_NAV_LINKS: ReadonlyArray<readonly [StudioPage, string]> = [
  ['overview', 'Studio'],
  ['moodboard', 'Moodboard'],
  ['palette', 'Palette'],
  ['styles', 'Toolkit'],
  ['graph', 'Graph'],
  ['desktop', 'Desktop UI'],
  ['phone', 'Phone UI'],
];

export function isStudioPage(value: string | null | undefined): value is StudioPage {
  return value !== null && value !== undefined && STUDIO_PAGES.includes(value as StudioPage);
}

function bodyStudioPage(): string | null {
  if (typeof document === 'undefined') {
    return null;
  }
  return document.body?.dataset?.page ?? null;
}

function isStandaloneStudioPath(pathname: string): boolean {
  if (pathname.includes('/docs/specs/ui/')) {
    return true;
  }
  return isStudioPage(bodyStudioPage());
}

function pageFile(page: StudioPage): string {
  return page === 'overview' ? 'index.html' : `${page}.html`;
}

export function buildStudioUrl(page: StudioPage, currentHref = window.location.href): string {
  const url = new URL(currentHref);

  if (isStandaloneStudioPath(url.pathname)) {
    const fileName = pageFile(page);
    const pathname =
      url.pathname === '/' || url.pathname === ''
        ? `/${fileName}`
        : url.pathname.endsWith('.html')
          ? url.pathname.replace(/\/[^/]*$/, `/${fileName}`)
          : url.pathname.endsWith('/')
            ? `${url.pathname}${fileName}`
            : `/${fileName}`;
    const nextPath = pathname;
    url.pathname = nextPath;
    url.searchParams.delete('design');
    url.hash = '';
    return url.toString();
  }

  if (page === 'overview') {
    url.searchParams.set('design', 'overview');
  } else {
    url.searchParams.set('design', page);
  }
  url.hash = '';
  return url.toString();
}
