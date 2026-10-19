import { useMemo, useState, type ReactNode } from 'react';

type ArticleRendererProps = {
  html: string;
  lang: string;
  dataSaver: boolean;
  expandedSections: boolean;
  fontSize: number;
  fontStyle: string;
  imageBackground: boolean;
  renderMath: boolean;
  onLinkClick: (title: string) => void;
};

type RenderOptions = Pick<ArticleRendererProps, 'lang' | 'dataSaver' | 'fontSize' | 'fontStyle' | 'imageBackground' | 'renderMath' | 'onLinkClick'> & { onImageClick: (src: string, caption: string) => void };

const ignoredClasses = ['mw-editsection', 'noprint', 'metadata', 'mw-empty-elt'];

function cleanTitle(href: string, lang: string): string | null {
  try {
    const url = new URL(href, 'https://' + lang + '.wikipedia.org');
    if (!url.hostname.endsWith('wikipedia.org') || !url.pathname.startsWith('/wiki/')) return null;
    return decodeURIComponent(url.pathname.slice(6)).replaceAll('_', ' ').split('#')[0];
  } catch { return null; }
}

function renderNode(node: Node, key: string, options: RenderOptions): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
  if (!(node instanceof HTMLElement)) return null;
  const element = node;
  const classNames = element.className.toString().split(/\s+/);
  if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'LINK', 'META'].includes(element.tagName) || ignoredClasses.some(name => classNames.includes(name))) return null;
  if (element.hidden || element.getAttribute('aria-hidden') === 'true') return null;
  const children = Array.from(element.childNodes).map((child, index) => renderNode(child, key + '-' + index, options));
  const tag = element.tagName.toLowerCase();
  if (tag === 'a') {
    const href = element.getAttribute('href') || '';
    const title = cleanTitle(href, options.lang);
    return <a key={key} href={href} title={element.title || undefined} onClick={event => { if (title) { event.preventDefault(); options.onLinkClick(title); } }}>{children}</a>;
  }
  if (tag === 'img') {
    if (options.dataSaver) return null;
    const src = element.getAttribute('src') || element.getAttribute('data-src') || '';
    if (!src) return null;
    const resolved = new URL(src, 'https://' + options.lang + '.wikipedia.org').toString();
    const caption = element.getAttribute('alt') || element.getAttribute('title') || '';
    return <m3e-card key={key} variant={options.imageBackground ? 'filled' : 'outlined'}><img src={resolved} alt={caption} loading="lazy" onClick={event => { event.stopPropagation(); options.onImageClick(resolved.replace(/\/\d+px-/, '/1200px-'), caption); }} /><m3e-list-item>{caption}</m3e-list-item></m3e-card>;
  }
  if (tag === 'table') {
    const label = element.querySelector('caption')?.textContent?.trim() || (classNames.includes('infobox') ? 'Article information' : 'Table');
    return <m3e-card key={key} variant={options.imageBackground ? 'filled' : 'outlined'}><m3e-list-item><span>{label}</span><span slot="supporting-text">{classNames.includes('infobox') ? 'Article information box' : 'Article table'}</span></m3e-list-item><table>{children}</table></m3e-card>;
  }
  if (classNames.includes('gallery')) {
    return <m3e-slide-group key={key} threshold={48} next-page-label="Next gallery images" previous-page-label="Previous gallery images">
      {Array.from(element.children).map((child, index) => <m3e-card key={key + '-gallery-' + index} variant={options.imageBackground ? 'filled' : 'outlined'}>{renderNode(child, key + '-gallery-content-' + index, options)}</m3e-card>)}
    </m3e-slide-group>;
  }
  if (tag === 'figure' || classNames.includes('thumb') || classNames.includes('gallerybox')) {
    return <m3e-card key={key} variant={options.imageBackground ? 'filled' : 'outlined'}><div>{children}</div></m3e-card>;
  }
  if (tag === 'math' || classNames.includes('mwe-math-element')) {
    if (!options.renderMath) {
      const alt = element.querySelector('img')?.getAttribute('alt') || element.textContent || '';
      return <span key={key}>{alt.replace(/\\(text|mathrm|mathbf)\{([^}]+)\}/g, '$2')}</span>;
    }
  }
  const safeTags = new Set(['article','section','div','span','p','br','hr','strong','b','em','i','u','s','sub','sup','blockquote','pre','code','ul','ol','li','dl','dt','dd','h1','h2','h3','h4','h5','h6','abbr','cite','q','small','ruby','rt','rp','math','mrow','mi','mn','mo','msup','msub','mfrac','semantics','annotation','picture','source','figcaption','caption','thead','tbody','tfoot','tr','td','th','colgroup','col','time','details','summary']);
  const safeTag = safeTags.has(tag) ? tag : 'span';
  const props: Record<string, any> = { key };
  if (tag === 'td' || tag === 'th') {
    const colspan = element.getAttribute('colspan'); const rowspan = element.getAttribute('rowspan');
    if (colspan) props.colSpan = Number(colspan);
    if (rowspan) props.rowSpan = Number(rowspan);
    if (tag === 'th') props.scope = element.getAttribute('scope') || 'col';
  }
  if (tag === 'ol' && element.getAttribute('start')) props.start = Number(element.getAttribute('start'));
  if (tag === 'abbr' && element.title) props.title = element.title;
  return React.createElement(safeTag, props, ...children);
}

export default function ArticleRenderer({ html, lang, dataSaver, expandedSections, fontSize, fontStyle, imageBackground, renderMath, onLinkClick }: ArticleRendererProps) {
  const [selectedImage, setSelectedImage] = useState<{ src: string; caption: string } | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const sections = useMemo(() => {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const body = document.querySelector('.mw-parser-output') || document.querySelector('body') || document.documentElement;
    const nodes = Array.from(body.children).filter(element => !['SCRIPT','STYLE','NAV'].includes(element.tagName) && !element.classList.contains('mw-jump-link'));
    const groups: { heading: HTMLElement | null; nodes: HTMLElement[] }[] = [];
    let current: { heading: HTMLElement | null; nodes: HTMLElement[] } = { heading: null, nodes: [] };
    for (const element of nodes) {
      const heading = element.tagName === 'H2' ? element : element.querySelector(':scope > h2');
      if (heading) {
        if (current.nodes.length || current.heading) groups.push(current);
        current = { heading, nodes: [] };
      } else current.nodes.push(element);
    }
    if (current.nodes.length || current.heading) groups.push(current);
    return groups;
  }, [html]);
  const options: RenderOptions = { lang, dataSaver, fontSize, fontStyle, imageBackground, renderMath, onLinkClick, onImageClick: (src, caption) => setSelectedImage({ src, caption }) };
  return <>
    {sections.map((section, index) => {
      const children = section.nodes.map((node, childIndex) => renderNode(node, index + '-' + childIndex, options));
      if (!section.heading) return <m3e-card key={'intro-' + index} variant="outlined"><div>{children}</div></m3e-card>;
      const title = section.heading.textContent?.replace('[edit]', '').trim() || 'Section';
      return <m3e-expansion-panel key={'section-' + index} open={expanded[index] ?? expandedSections} toggle-position="after">
        <span slot="header">{title}</span>
        <div>{children}</div>
        <m3e-list-item slot="actions"><m3e-button variant="text" onClick={() => setExpanded(previous => ({ ...previous, [index]: !(previous[index] ?? expandedSections) }))}>{(expanded[index] ?? expandedSections) ? 'Collapse section' : 'Expand section'}</m3e-button></m3e-list-item>
      </m3e-expansion-panel>;
    })}
    <m3e-dialog open={Boolean(selectedImage)} dismissible close-label="Close image" onClick={event => { if (event.target === event.currentTarget) setSelectedImage(null); }}>
      <span slot="header">{selectedImage?.caption || 'Image viewer'}</span>
      {selectedImage && <m3e-card variant="outlined"><img src={selectedImage.src} alt={selectedImage.caption} /><m3e-list-item>{selectedImage.caption}</m3e-list-item></m3e-card>}
      <m3e-list-item slot="actions"><m3e-button variant="filled" onClick={() => setSelectedImage(null)}>Close</m3e-button></m3e-list-item>
    </m3e-dialog>
  </>;
}
