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

function isStandaloneStudioPath(pathname: string): boolean {
  return pathname.includes('/docs/specs/ui/');
}

function pageFile(page: StudioPage): string {
  return page === 'overview' ? 'index.html' : `${page}.html`;
}

export function buildStudioUrl(page: StudioPage, currentHref = window.location.href): string {
  const url = new URL(currentHref);

  if (isStandaloneStudioPath(url.pathname)) {
    const nextPath = url.pathname.replace(/\/[^/]*$/, `/${pageFile(page)}`);
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
