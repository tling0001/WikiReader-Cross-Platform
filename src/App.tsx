import React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HTMLAttributes } from 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'm3e-circular-progress-indicator': HTMLAttributes<HTMLElement> & { indeterminate?: boolean; value?: number; max?: number; variant?: string };
      'm3e-linear-progress-indicator': HTMLAttributes<HTMLElement> & { mode?: 'determinate' | 'indeterminate' | 'query'; value?: number; max?: number; variant?: string };
      'm3e-action-list': HTMLAttributes<HTMLElement> & { variant?: 'standard' | 'segmented' };
      'm3e-expandable-list-item': HTMLAttributes<HTMLElement> & { open?: boolean; disabled?: boolean };
      'm3e-list-action': HTMLAttributes<HTMLElement> & { key?: React.Key; disabled?: boolean; href?: string; target?: string };
    }
  }
}
import ArticleRenderer from './ArticleRenderer';

type Page = { title: string; description?: string; extract?: string; thumbnail?: { source: string; width?: number; height?: number }; pageid?: number; lang?: string; views?: number; viewHistory?: { views?: number }[] };
type SearchResult = { title: string; pageid?: number; snippet: string; titleSnippet: string; redirectTitle?: string; thumbnail?: { source: string; width?: number; height?: number } };
type FeedImage = { title?: string; thumbnail?: { source: string; width?: number; height?: number }; image?: { source: string; width?: number; height?: number }; description?: { text?: string }; artist?: { name?: string; text?: string }; credit?: { text?: string }; file_page?: string };
type FeedNews = { story?: string; links?: Page[] };
type FeedOnThisDay = { text?: string; year?: number; pages?: Page[] };
type Entry = { title: string; lang: string; visited: number; description?: string; thumbnail?: string };
type ArticleLanguage = { lang: string; title: string; name?: string };
type Section = 'home' | 'history' | 'saved' | 'settings' | 'about';
type Preferences = { theme: 'auto' | 'light' | 'dark'; lang: string; fontStyle: string; colorScheme: string; fontSize: number; blackTheme: boolean; dataSaver: boolean; feedEnabled: boolean; expandedSections: boolean; imageBackground: boolean; immersiveMode: boolean; renderMath: boolean; browsingHistory: boolean; searchHistory: boolean };
const defaults: Preferences = { theme: 'auto', lang: 'en', fontStyle: 'sans', colorScheme: '#ffffff', fontSize: 16, blackTheme: false, dataSaver: false, feedEnabled: true, expandedSections: false, imageBackground: false, immersiveMode: typeof window !== 'undefined' && window.matchMedia('(max-width: 599px)').matches, renderMath: true, browsingHistory: true, searchHistory: true };
const readStore = <T,>(key: string, fallback: T): T => { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } };
const writeStore = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage may be unavailable. */ } };
type CachedArticle = { html: string; savedAt: number };
const cacheKey = 'wr-article-cache';
const getCachedArticle = (lang: string, title: string) => readStore<Record<string, CachedArticle>>(cacheKey, {})[lang + ':' + title]?.html ?? '';
const cacheArticle = (lang: string, title: string, html: string) => { if (!html || html.length > 350000) return; const cache = readStore<Record<string, CachedArticle>>(cacheKey, {}); cache[lang + ':' + title] = { html, savedAt: Date.now() }; writeStore(cacheKey, Object.fromEntries(Object.entries(cache).sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, 5))); };
const titleToPath = (title: string) => encodeURIComponent(title.replaceAll(' ', '_'));
const api = async <T,>(url: string): Promise<T> => { const response = await fetch(url, { headers: { 'Api-User-Agent': 'WikiReader/2.5.5 (desktop reader)' } }); if (!response.ok) throw new Error('Wikipedia returned ' + response.status); return response.json() as Promise<T>; };
const readArticleResponse = async (response: Response, onProgress: (progress: number | null) => void): Promise<string> => {
  const total = Number(response.headers.get('content-length'));
  if (!response.body || !Number.isFinite(total) || total <= 0) {
    onProgress(null);
    return response.text();
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let html = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    html += decoder.decode(value, { stream: true });
    onProgress(Math.min(1, received / total));
  }
  html += decoder.decode();
  onProgress(1);
  return html;
};
const languages = [['en','English'],['es','Español'],['fr','Français'],['de','Deutsch'],['it','Italiano'],['pt','Português'],['ja','日本語'],['zh','中文'],['ru','Русский'],['ar','العربية'],['hi','हिन्दी'],['ko','한국어'],['nl','Nederlands'],['pl','Polski'],['sv','Svenska'],['uk','Українська'],['fa','فارسی'],['tr','Türkçe'],['vi','Tiếng Việt'],['id','Bahasa Indonesia']] as const;

function renderSearchSnippet(html: string, prefix: string): React.ReactNode {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const renderNode = (node: Node, key: string): React.ReactNode => {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
    if (!(node instanceof HTMLElement)) return null;
    const children = Array.from(node.childNodes).map((child, index) => renderNode(child, key + '-' + index));
    return node.classList.contains('searchmatch')
      ? <strong key={key}>{children}</strong>
      : <React.Fragment key={key}>{children}</React.Fragment>;
  };
  return Array.from(parsed.body.childNodes).map((node, index) => renderNode(node, prefix + '-' + index));
}

export default function App() {
  const [section, setSection] = useState<Section>('home');
  const [prefs, setPrefs] = useState<Preferences>(() => ({ ...defaults, ...readStore<Partial<Preferences>>('wr-preferences', {}) }));
  const [systemDark, setSystemDark] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [immersiveHidden, setImmersiveHidden] = useState(false);
  const [history, setHistory] = useState<Entry[]>(() => readStore('wr-history', []));
  const [saved, setSaved] = useState<Entry[]>(() => readStore('wr-saved', []));
  const [searchHistory, setSearchHistory] = useState<string[]>(() => readStore('wr-search-history', []));
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchViewRef = useRef<(HTMLElement & { open: boolean }) | null>(null);
  const [suggestions, setSuggestions] = useState<Page[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [feed, setFeed] = useState<{ featured: Page | null; trending: Page[]; image: FeedImage | null; news: FeedNews[]; onthisday: FeedOnThisDay[] }>({ featured: null, trending: [], image: null, news: [], onthisday: [] });
  const [feedLoading, setFeedLoading] = useState(true);
  const [article, setArticle] = useState<Page | null>(null);
  const [articleHtml, setArticleHtml] = useState('');
  const [articleLanguages, setArticleLanguages] = useState<ArticleLanguage[]>([]);
  const [loading, setLoading] = useState(false);
  const [articleProgress, setArticleProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [stack, setStack] = useState<string[]>([]);
  const [showContents, setShowContents] = useState(false);
  const [languageFilter, setLanguageFilter] = useState('');
  const [listFilter, setListFilter] = useState('');
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 600px)').matches);
  const [expandedLayout, setExpandedLayout] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 840px)').matches);
  const [showNavigation, setShowNavigation] = useState(false);
  const [railExpanded, setRailExpanded] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 840px)').matches);
  const [showClearSavedDialog, setShowClearSavedDialog] = useState(false);
  const [showGlobalLanguagePicker, setShowGlobalLanguagePicker] = useState(false);
  const [globalLanguageFilter, setGlobalLanguageFilter] = useState('');
  const lang = prefs.lang;
  const update = <K extends keyof Preferences,>(key: K, value: Preferences[K]) => setPrefs(previous => ({ ...previous, [key]: value }));

  useEffect(() => {
    const query = window.matchMedia('(min-width: 600px)');
    const updateWidth = () => setWide(query.matches);
    updateWidth();
    query.addEventListener('change', updateWidth);
    const expandedQuery = window.matchMedia('(min-width: 840px)');
    const updateExpanded = () => { setExpandedLayout(expandedQuery.matches); setRailExpanded(expandedQuery.matches); };
    updateExpanded();
    expandedQuery.addEventListener('change', updateExpanded);
    return () => { query.removeEventListener('change', updateWidth); expandedQuery.removeEventListener('change', updateExpanded); };
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const updateSystemTheme = () => setSystemDark(media.matches);
    updateSystemTheme();
    media.addEventListener('change', updateSystemTheme);
    return () => media.removeEventListener('change', updateSystemTheme);
  }, []);

  useEffect(() => { writeStore('wr-preferences', prefs); }, [prefs]);
  useEffect(() => { writeStore('wr-history', history); }, [history]);
  useEffect(() => { writeStore('wr-saved', saved); }, [saved]);
  useEffect(() => { writeStore('wr-search-history', searchHistory); }, [searchHistory]);
  
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      document.querySelectorAll<HTMLElement>('.article-content a').forEach(anchor => {
        anchor.style.color = 'var(--md-sys-color-primary)';
        anchor.style.textDecoration = 'none';
      });
      document.querySelectorAll<HTMLElement>('.article-infobox').forEach(infobox => {
        infobox.style.marginInline = 'auto';
        infobox.style.width = '100%';
        infobox.style.maxWidth = '512px';
        infobox.querySelector<HTMLElement>('[slot="items"]')?.style.setProperty('background-color', 'var(--md-sys-color-surface-bright)');
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [articleHtml, article?.title, prefs.colorScheme, prefs.theme, systemDark]);

  useEffect(() => {
    let active = true;
    if (!prefs.feedEnabled || prefs.dataSaver) { setFeed({ featured: null, trending: [], image: null, news: [], onthisday: [] }); setFeedLoading(false); return () => { active = false; }; }
    setFeedLoading(true);
    const now = new Date();
    const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('/');
    api<{
      tfa?: { titles?: { canonical?: string; normalized?: string }; thumbnail?: Page['thumbnail']; originalimage?: Page['thumbnail']; description?: string; extract?: string };
      mostread?: { articles?: { titles?: { canonical?: string; normalized?: string }; thumbnail?: Page['thumbnail']; originalimage?: Page['thumbnail']; description?: string; extract?: string; pageid?: number; views?: number; viewHistory?: { views?: number }[] }[] };
      image?: FeedImage;
      news?: { story?: string; links?: { titles?: { canonical?: string; normalized?: string }; thumbnail?: Page['thumbnail']; description?: string; extract?: string; pageid?: number }[] }[];
      onthisday?: { text?: string; year?: number; pages?: { titles?: { canonical?: string; normalized?: string }; thumbnail?: Page['thumbnail']; description?: string; extract?: string; pageid?: number }[] }[];
    }>('https://' + lang + '.wikipedia.org/api/rest_v1/feed/featured/' + date)
      .then(data => {
        if (!active) return;
        const normalize = (item: { title?: string; titles?: { canonical?: string; normalized?: string }; thumbnail?: Page['thumbnail']; originalimage?: Page['thumbnail']; description?: string; extract?: string; pageid?: number; views?: number; viewHistory?: { views?: number }[] }): Page => ({
          title: (item.titles?.canonical || item.titles?.normalized || item.title || '').replaceAll('_', ' '),
          thumbnail: item.thumbnail ?? item.originalimage, description: item.description, extract: item.extract, pageid: item.pageid, views: item.views, viewHistory: item.viewHistory
        });
        const trending = (data.mostread?.articles ?? []).map(normalize).filter(item => item.title).slice(0, 15);
        setFeed({
          featured: data.tfa ? normalize(data.tfa) : null,
          trending,
          image: data.image ?? null,
          news: (data.news ?? []).map(item => ({ story: item.story, links: (item.links ?? []).map(normalize).filter(link => link.title) })),
          onthisday: (data.onthisday ?? []).map(item => ({ text: item.text, year: item.year, pages: (item.pages ?? []).map(normalize).filter(page => page.title) }))
        });
        setFeedLoading(false);

        // Match Android's per-article views graph with real Wikimedia pageview history.
        const endDate = new Date();
        endDate.setUTCDate(endDate.getUTCDate() - 1);
        const startDate = new Date(endDate);
        startDate.setUTCDate(startDate.getUTCDate() - 29);
        const apiDate = (value: Date) => value.toISOString().slice(0, 10).replaceAll('-', '');
        const start = apiDate(startDate);
        const end = apiDate(endDate);
        void Promise.all(trending.map(async item => {
          try {
            const encodedTitle = encodeURIComponent(item.title.replaceAll(' ', '_'));
            const history = await api<{ items?: { views?: number }[] }>(
              'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/' +
              lang + '.wikipedia.org/all-access/user/' + encodedTitle + '/daily/' + start + '/' + end
            );
            const points = history.items ?? [];
            return [item.title, points.length ? points.map(point => ({ views: point.views ?? 0 })) : item.viewHistory] as const;
          } catch {
            return [item.title, item.viewHistory] as const;
          }
        })).then(histories => {
          if (!active) return;
          const byTitle = new Map(histories);
          setFeed(current => ({
            ...current,
            trending: current.trending.map(item => ({
              ...item,
              viewHistory: byTitle.get(item.title) ?? item.viewHistory
            }))
          }));
        });
      })
      .catch(() => { if (active) { setFeed({ featured: null, trending: [], image: null, news: [], onthisday: [] }); setFeedLoading(false); } });
    return () => { active = false; };
  }, [lang, prefs.feedEnabled, prefs.dataSaver]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) { setSuggestions([]); setSearchResults([]); setSearching(false); return; }
    let active = true;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const [prefixData, matchData] = await Promise.all([
          api<{ query?: { pages?: { title: string; pageid: number; thumbnail?: { source: string; width?: number; height?: number }; terms?: { description?: string[] } }[] } }>('https://' + lang + '.wikipedia.org/w/api.php?action=query&generator=prefixsearch&gpssearch=' + encodeURIComponent(term) + '&gpslimit=8&prop=pageimages%7Cpageterms&piprop=thumbnail&pithumbsize=100&wbptterms=description&format=json&formatversion=2&origin=*'),
          api<{ query?: { search?: { title: string; pageid: number; snippet?: string; titlesnippet?: string; redirecttitle?: string }[] } }>('https://' + lang + '.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + encodeURIComponent(term) + '&srnamespace=0&srlimit=8&srprop=snippet%7Ctitlesnippet%7Credirecttitle&format=json&formatversion=2&origin=*')
        ]);
        if (active) {
          const prefixPages = (prefixData.query?.pages ?? []).map(page => ({ title: page.title.replaceAll('_', ' '), pageid: page.pageid, thumbnail: page.thumbnail, description: page.terms?.description?.[0] }));
          setSuggestions(prefixPages);
          const thumbnails = new Map(prefixPages.map(page => [page.title.toLowerCase(), page.thumbnail]));
          setSearchResults((matchData.query?.search ?? []).map(item => ({
            title: item.title.replaceAll('_', ' '),
            pageid: item.pageid,
            snippet: item.snippet ?? '',
            titleSnippet: item.titlesnippet || item.title,
            redirectTitle: item.redirecttitle?.replaceAll('_', ' '),
            thumbnail: thumbnails.get(item.title.replaceAll('_', ' ').toLowerCase())
          })));
        }
      } catch { if (active) { setSuggestions([]); setSearchResults([]); } }
      finally { if (active) setSearching(false); }
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, lang]);

  useEffect(() => {
    setImmersiveHidden(false);
    if (!prefs.immersiveMode || section !== 'home') return;
    const pane = document.querySelector<HTMLElement & { shadowRoot?: ShadowRoot }>('m3e-content-pane.app-content');
    const scroller = pane?.shadowRoot?.querySelector<HTMLElement>('.scroll-container') || pane;
    if (!scroller) return;
    let previousTop = scroller.scrollTop;
    const onScroll = () => {
      const top = scroller.scrollTop;
      if (top <= 24 || top < previousTop - 4) setImmersiveHidden(false);
      else if (top > previousTop + 4) setImmersiveHidden(true);
      previousTop = top;
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [prefs.immersiveMode, section, article?.title]);

  useEffect(() => {
    const view = searchViewRef.current;
    if (!view) return;
    const onToggle = () => setSearchOpen(view.open);
    const onQuery = (event: Event) => {
      const term = (event as CustomEvent<{ term: string }>).detail?.term;
      if (typeof term === 'string') setQuery(current => current === term ? current : term);
    };
    const onClear = () => setQuery('');
    view.addEventListener('toggle', onToggle);
    view.addEventListener('query', onQuery);
    view.addEventListener('clear', onClear);
    return () => {
      view.removeEventListener('toggle', onToggle);
      view.removeEventListener('query', onQuery);
      view.removeEventListener('clear', onClear);
    };
  }, [section]);

  useEffect(() => {
    if (!searchOpen) return;
    const frame = window.requestAnimationFrame(() => {
      const view = searchViewRef.current;
      if (view) {
        view.open = true;
        view.querySelector<HTMLInputElement>('input[aria-label="Search Wikipedia"]')?.focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [searchOpen]);

  const openArticle = useCallback(async (title: string, push = true, requestedLang = lang) => {
    setError(''); setLoading(true); setArticleProgress(null); setSection('home'); setSearchOpen(false); setQuery(''); setSuggestions([]); setSearchResults([]); setShowContents(false); setArticleLanguages([]); document.activeElement instanceof HTMLElement && document.activeElement.blur();
    if (prefs.searchHistory && title.trim()) setSearchHistory(previous => [title.trim(), ...previous.filter(item => item.toLowerCase() !== title.trim().toLowerCase())].slice(0, 30));
    try {
      const data = await api<Page>('https://' + requestedLang + '.wikipedia.org/api/rest_v1/page/summary/' + titleToPath(title));
      const current = { ...data, lang: requestedLang };
      setArticle(current);
      if (push) setStack(previous => [...previous, current.title || title]);
      try {
        const languageData = await api<{ query?: { pages?: { langlinks?: { lang: string; title: string; langname?: string }[] }[] } }>('https://' + requestedLang + '.wikipedia.org/w/api.php?action=query&prop=langlinks&titles=' + encodeURIComponent(current.title || title) + '&lllimit=500&llprop=langname&format=json&formatversion=2&origin=*');
        setArticleLanguages((languageData.query?.pages?.[0]?.langlinks ?? []).map(item => ({ lang: item.lang, title: item.title, name: item.langname || item.lang })));
      } catch { setArticleLanguages([]); }
      if (prefs.browsingHistory) {
        const entry: Entry = { title: current.title || title, lang: requestedLang, visited: Date.now(), description: current.description, thumbnail: current.thumbnail?.source };
        setHistory(previous => [entry, ...previous.filter(item => !(item.title === entry.title && item.lang === requestedLang))].slice(0, 500));
      }
      try {
        const response = await fetch('https://' + requestedLang + '.wikipedia.org/api/rest_v1/page/html/' + titleToPath(current.title || title), { headers: { 'Api-User-Agent': 'WikiReader/2.5.5 (desktop reader)' } });
        if (response.ok) { const html = await readArticleResponse(response, setArticleProgress); setArticleHtml(html); cacheArticle(requestedLang, current.title || title, html); }
        else { setArticleHtml(getCachedArticle(requestedLang, current.title || title)); setArticleProgress(1); }
      } catch { setArticleHtml(getCachedArticle(requestedLang, current.title || title)); setArticleProgress(1); }
    } catch (reason) {
      const cached = getCachedArticle(requestedLang, title);
      if (cached) {
        setArticle({ title, lang: requestedLang }); setArticleHtml(cached); setArticleProgress(1);
        if (push) setStack(previous => [...previous, title]);
        if (prefs.browsingHistory) setHistory(previous => [{ title, lang: requestedLang, visited: Date.now() }, ...previous.filter(item => !(item.title === title && item.lang === requestedLang))].slice(0, 500));
      } else setError(reason instanceof Error ? reason.message : 'Could not load this article.');
    } finally { setLoading(false); setArticleProgress(previous => previous === null ? null : 1); }
  }, [lang, prefs.browsingHistory, prefs.searchHistory]);

  useEffect(() => {
    const openFromRenderer = (event: Event) => { const detail = (event as CustomEvent<{ title: string; lang: string }>).detail; if (detail?.title) void openArticle(detail.title, true, detail.lang || lang); };
    window.addEventListener('wikireader:open-article', openFromRenderer);
    return () => window.removeEventListener('wikireader:open-article', openFromRenderer);
  }, [openArticle, lang]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      const link = target?.closest('a') as HTMLAnchorElement | null;
      if (!link || !article) return;
      const href = link.getAttribute('href') || '';
      if (href.startsWith('./') || href.startsWith('/wiki/')) {
        event.preventDefault();
        const title = decodeURIComponent(href.replace(/^\.\//, '').replace(/^\/wiki\//, '').split('#')[0]).replaceAll('_', ' ');
        if (title) void openArticle(title, true, article.lang || lang);
      } else if (href.startsWith('http')) {
        try { const url = new URL(href); if (url.hostname.endsWith('wikipedia.org') && url.pathname.startsWith('/wiki/')) { event.preventDefault(); void openArticle(decodeURIComponent(url.pathname.slice(6)).replaceAll('_', ' '), true, article.lang || lang); } } catch { /* Leave external links unchanged. */ }
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [article, lang, openArticle]);

  const isSaved = article ? saved.some(item => item.title === article.title && item.lang === (article.lang || lang)) : false;
  const toggleSaved = () => {
    if (!article) return;
    const entry: Entry = { title: article.title, lang: article.lang || lang, visited: Date.now(), description: article.description, thumbnail: article.thumbnail?.source };
    setSaved(previous => isSaved ? previous.filter(item => !(item.title === entry.title && item.lang === entry.lang)) : [entry, ...previous]);
  };
  const doSearch = () => { const value = query.trim(); if (value) { setSearchOpen(false); void openArticle(value); } };
  const focusSearch = () => { setImmersiveHidden(false); setSearchOpen(true); };
  const back = () => { if (stack.length > 1) { const previous = stack[stack.length - 2]; setStack(items => items.slice(0, -1)); void openArticle(previous, false); } else { setArticle(null); setArticleHtml(''); setStack([]); } };
  const shareArticle = async () => {
    if (!article) return;
    const url = 'https://' + (article.lang || lang) + '.wikipedia.org/wiki/' + titleToPath(article.title);
    try {
      if (navigator.share) await navigator.share({ title: article.title, text: article.description || article.extract || article.title, url });
      else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
      else window.open(url, '_blank', 'noopener,noreferrer');
    } catch (reason) {
      if (reason instanceof Error && reason.name !== 'AbortError') setError('Unable to share this article.');
    }
  };
  const randomArticle = async () => {
    try { const data = await api<{ query?: { pages?: { title: string }[] } }>('https://' + lang + '.wikipedia.org/w/api.php?action=query&generator=random&grnnamespace=0&grnlimit=1&format=json&formatversion=2&origin=*'); const title = data.query?.pages?.[0]?.title; if (title) void openArticle(title); }
    catch { setError('Unable to get a random article right now.'); }
  };
  const filteredHistory = history.filter(item => (item.title + ' ' + (item.description || '')).toLowerCase().includes(listFilter.toLowerCase()));
  const filteredSaved = saved.filter(item => (item.title + ' ' + (item.description || '')).toLowerCase().includes(listFilter.toLowerCase()));

  const goToSection = (target: Section) => {
    setSearchOpen(false); setSection(target); setShowNavigation(false); setListFilter('');
    if (target === 'home' && !article) { setArticleHtml(''); setArticleLanguages([]); setStack([]); setShowContents(false); setQuery(''); setSuggestions([]); }
  };
  const returnFromSettings = () => { setSearchOpen(false); setSection('home'); setShowNavigation(false); setListFilter(''); };
  const navigationItems = <>
    <m3e-nav-item selected={section === 'home'} onClick={() => goToSection('home')}><m3e-icon slot="icon" variant="rounded" name="home" filled={section === 'home'} />Home</m3e-nav-item>
    <m3e-nav-item selected={section === 'saved'} onClick={() => goToSection('saved')}><m3e-icon slot="icon" variant="rounded" name="download_done" filled={section === 'saved'} />Saved</m3e-nav-item>
    {prefs.browsingHistory && <m3e-nav-item selected={section === 'history'} onClick={() => goToSection('history')}><m3e-icon slot="icon" variant="rounded" name="history" filled={section === 'history'} />History</m3e-nav-item>}
    <m3e-nav-item selected={section === 'settings'} onClick={() => goToSection('settings')}><m3e-icon slot="icon" variant="rounded" name="settings" filled={section === 'settings'} />Settings</m3e-nav-item>
    <m3e-nav-item selected={section === 'about'} onClick={() => goToSection('about')}><m3e-icon slot="icon" variant="rounded" name="info" filled={section === 'about'} />About</m3e-nav-item>
  </>;
  const searchActive = query.trim().length > 1;
  const blackThemeActive = prefs.blackTheme && (prefs.theme === 'dark' || (prefs.theme === 'auto' && systemDark));
  const blackThemeStyle = blackThemeActive ? ({
    '--md-sys-color-background': '#000000',
    '--md-sys-color-surface': '#000000',
    '--md-sys-color-surface-dim': '#000000',
    '--md-sys-color-surface-container-lowest': '#000000',
    '--md-sys-color-surface-container-low': '#000000'
  } as React.CSSProperties) : undefined;
  const screenContent = <div className="screen-content">
    {error && <m3e-card variant="filled"><m3e-list slot="content" variant="standard"><m3e-list-item><m3e-icon variant="rounded" slot="leading" name="error" />{error}<m3e-button slot="trailing" variant="text" onClick={() => setError('')}>Dismiss</m3e-button></m3e-list-item></m3e-list></m3e-card>}
    {section === 'home' && (article ? <ArticleScreen article={article} html={articleHtml} loading={loading} saved={isSaved} onBack={back} onSave={toggleSaved} fontSize={prefs.fontSize} dataSaver={prefs.dataSaver} expandedSections={prefs.expandedSections} fontStyle={prefs.fontStyle} imageBackground={prefs.imageBackground} renderMath={prefs.renderMath} languages={articleLanguages} onChooseLanguage={(targetLang, targetTitle) => { update('lang', targetLang); void openArticle(targetTitle, true, targetLang); }} /> : <HomeScreen feed={feed} loading={feedLoading} onOpen={title => void openArticle(title)} onRandom={randomArticle} enabled={prefs.feedEnabled && !prefs.dataSaver} wide={wide} expanded={expandedLayout} />)}
    {section === 'history' && <HistoryScreen entries={filteredHistory} total={history.length} onOpen={entry => void openArticle(entry.title, true, entry.lang)} />}
    {section === 'saved' && <SavedArticlesScreen entries={saved} total={saved.length} languageCount={new Set(saved.map(entry => entry.lang)).size} onOpen={entry => void openArticle(entry.title, true, entry.lang)} />}
    {section === 'settings' && <SettingsScreen prefs={prefs} update={update} languageFilter={languageFilter} setLanguageFilter={setLanguageFilter} onClearData={() => { setHistory([]); setSaved([]); setSearchHistory([]); writeStore(cacheKey, {}); }} onReset={() => { setPrefs({ ...defaults }); setLanguageFilter(''); }} />}
    {section === 'about' && <AboutScreen />}

  </div>;
  const titleBySection: Record<Section, string> = { home: article?.title ?? 'WikiReader', history: 'History', saved: 'Saved articles', settings: 'Settings', about: 'About WikiReader' };
  return <m3e-theme className="app-shell" color={prefs.colorScheme.toLowerCase() === '#ffffff' ? '#6650a4' : prefs.colorScheme} scheme={prefs.theme} variant="tonal-spot" motion="expressive" style={{ ...(blackThemeStyle || {}), fontFamily:'Roboto, Arial, sans-serif', fontSize:'16px', lineHeight:1.5, letterSpacing:'0.5px' } as React.CSSProperties}>
    <m3e-drawer-container start={showNavigation && !wide} start-mode="over" onChange={event => setShowNavigation(Boolean((event.currentTarget as HTMLElement & { start?: boolean }).start))} style={{ backgroundColor: 'var(--md-sys-color-surface-container-low)' }}>
      <nav slot="start" aria-label="Main navigation" style={{ backgroundColor: 'var(--md-sys-color-surface-container-low)', color: 'var(--md-sys-color-on-surface)' }}>
        <m3e-nav-rail mode="expanded">{navigationItems}</m3e-nav-rail>
      </nav>
    <div className="app-layout" style={{ backgroundColor: 'var(--md-sys-color-surface-container-low)', color: 'var(--md-sys-color-on-surface)' }}>
      {wide && <m3e-nav-rail mode={railExpanded ? "expanded" : "compact"} style={{ backgroundColor: 'var(--md-sys-color-surface-container-low)', color: 'var(--md-sys-color-on-surface)' }}>
        <m3e-icon-button title="Toggle navigation rail" aria-label="Toggle navigation rail" onClick={() => setRailExpanded(value => !value)}><m3e-icon variant="rounded" name={railExpanded ? "menu_open" : "menu"} /></m3e-icon-button>
        {navigationItems}
      </m3e-nav-rail>}
      <div className="app-main">
        <m3e-app-bar centered className={prefs.immersiveMode && immersiveHidden && section === 'home' ? 'immersive-hidden' : ''}>
          {section !== 'home'
            ? <m3e-icon-button slot="leading-icon" variant="tonal" title="Back" aria-label="Back" onClick={() => section === 'settings' ? returnFromSettings() : goToSection('home')}><m3e-icon variant="rounded" name="arrow_back" filled /></m3e-icon-button>
            : wide
              ? <m3e-icon-button slot="leading-icon" title="Search Wikipedia" aria-label="Search Wikipedia" onClick={focusSearch}><m3e-icon variant="rounded" name="search" /></m3e-icon-button>
              : <m3e-icon-button slot="leading-icon" title="Open navigation" onClick={() => setShowNavigation(true)}><m3e-icon variant="rounded" name="menu" /></m3e-icon-button>}
          {section === 'history' || section === 'saved' ? null : section === 'home' ? <m3e-search-view ref={searchViewRef} className={'app-search-view' + (prefs.immersiveMode && immersiveHidden ? ' immersive-hidden' : '')} slot="title" mode="fullscreen" open={searchOpen} clear-label="Clear search" close-label="Close search" style={{ width: '100%', minWidth: 0, flex: '1 1 auto' }}>
            <input slot="input" aria-label="Search Wikipedia" placeholder="Search Wikipedia" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') doSearch(); }} />
            {searchActive ? <>
              <m3e-heading level="6" variant="label" size="large" style={{ padding: '14px 32px 8px' }}>Title matches</m3e-heading>
              <div style={{ display:'grid', gridTemplateColumns:wide ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)', gap:'2px', padding:'0 16px' }}>
                {searching && <m3e-list-item style={{ gridColumn:'1 / -1' }}><m3e-circular-progress-indicator indeterminate />Searching Wikipedia…</m3e-list-item>}
                {suggestions.map(item => <m3e-list-item-button key={item.pageid ?? item.title} style={{ minWidth:0, '--m3e-list-item-container-color':'var(--md-sys-color-surface-container-high)' } as React.CSSProperties} onClick={() => void openArticle(item.title.replaceAll('_', ' '))}>
                  {item.thumbnail?.source && <img slot="trailing" src={item.thumbnail.source} alt="" width="56" height="56" />}
                  <span>{item.title.replaceAll('_', ' ')}</span>
                  {item.description && <span slot="supporting-text">{item.description}</span>}
                </m3e-list-item-button>)}
                {!searching && suggestions.length === 0 && <m3e-list-item style={{ gridColumn:'1 / -1' }}>No title matches found.</m3e-list-item>}
              </div>
              <m3e-heading level="6" variant="label" size="large" style={{ padding: '14px 32px 8px' }}>In-article matches</m3e-heading>
              <div style={{ display:'grid', gridTemplateColumns:wide ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)', gap:'2px', padding:'0 16px' }}>
                {searchResults.map(item => <m3e-list-item-button key={item.pageid ?? item.title} style={{ minWidth:0, '--m3e-list-item-container-color':'var(--md-sys-color-surface-container-high)' } as React.CSSProperties} onClick={() => void openArticle(item.title.replaceAll('_', ' '))}>
                  {item.thumbnail?.source && <img slot="trailing" src={item.thumbnail.source} alt="" width="56" height="56" />}
                  {item.redirectTitle && <span slot="overline">Redirected from {item.redirectTitle.replaceAll('_', ' ')}</span>}
                  <span>{renderSearchSnippet(item.titleSnippet.replaceAll('_', ' '), String(item.pageid ?? item.title))}</span>
                  <span slot="supporting-text">{renderSearchSnippet(item.snippet, 'snippet-' + String(item.pageid ?? item.title))}</span>
                </m3e-list-item-button>)}
                {!searching && searchResults.length === 0 && <m3e-list-item style={{ gridColumn:'1 / -1' }}>No in-article matches found.</m3e-list-item>}
              </div>
            </> : prefs.searchHistory && searchHistory.length > 0 ? <>
              <div style={{ display:'flex', alignItems:'center', padding:'4px 32px', gap:'8px' }}>
                <m3e-heading level="6" variant="label" size="large">History</m3e-heading>
                <span style={{ flex:'1 1 auto' }} />
                <m3e-button variant="text" disabled={searchHistory.length === 0} onClick={() => setSearchHistory([])}>Clear</m3e-button>
              </div>
              <m3e-list variant="standard">
                {searchHistory.slice(0, 8).map(item => <m3e-list-item-button key={item} onClick={() => { setQuery(item); setSearchOpen(true); }}>
                  <m3e-icon slot="leading" variant="rounded" name="history" />
                  <span>{item}</span>
                  <m3e-icon slot="trailing" variant="rounded" name="north_west" />
                </m3e-list-item-button>)}
              </m3e-list>
            </> : null}</m3e-search-view> : <span slot="title">{titleBySection[section]}</span>}
          {section === 'history' ? <m3e-icon-button slot="trailing" title="Clear history" aria-label="Clear history" disabled={history.length === 0} onClick={() => setHistory([])}><m3e-icon variant="rounded" name="delete" /></m3e-icon-button> : section === 'saved' ? <m3e-icon-button slot="trailing" title="Delete all saved articles" aria-label="Delete all saved articles" disabled={saved.length === 0} onClick={() => setShowClearSavedDialog(true)}><m3e-icon variant="rounded" name="delete" /></m3e-icon-button> : section === 'settings' ? <m3e-icon-button slot="trailing" title="Reset settings" onClick={() => window.dispatchEvent(new Event('wikireader:reset-settings'))}><m3e-icon variant="rounded" name="refresh" /></m3e-icon-button> : section === 'home' ? <m3e-icon-button slot="trailing" variant="tonal" title="Random article" onClick={() => void randomArticle()}><m3e-icon variant="rounded" name="shuffle" filled /></m3e-icon-button> : null}
        </m3e-app-bar>
        {loading && <m3e-linear-progress-indicator className={prefs.immersiveMode && immersiveHidden && section === 'home' ? 'immersive-hidden' : ''} mode={articleProgress === null ? 'indeterminate' : 'determinate'} value={articleProgress ?? undefined} max={1} />}
        <m3e-content-pane className="app-content" style={{ '--m3e-content-pane-container-color': 'var(--md-sys-color-surface-container-low)', color: 'var(--md-sys-color-on-surface)' } as React.CSSProperties}>{screenContent}</m3e-content-pane>
      </div>
    </div>
</m3e-drawer-container>
    {showGlobalLanguagePicker && <LanguagePickerDialog open={showGlobalLanguagePicker} filter={globalLanguageFilter} setFilter={setGlobalLanguageFilter} currentLang={prefs.lang} title="Wikipedia language" onClose={() => setShowGlobalLanguagePicker(false)} onChoose={targetLang => { update('lang', targetLang); setShowGlobalLanguagePicker(false); setGlobalLanguageFilter(''); }} />}
    {showClearSavedDialog && <m3e-dialog open dismissible close-label="Cancel deleting saved articles"><span slot="header">Delete all saved articles?</span><m3e-list-item>This removes all saved articles from this device.</m3e-list-item><m3e-list-item slot="actions"><m3e-button variant="text" onClick={() => setShowClearSavedDialog(false)}>Cancel</m3e-button><m3e-button variant="filled" onClick={() => { setSaved([]); setShowClearSavedDialog(false); }}>Delete all</m3e-button></m3e-list-item></m3e-dialog>}
    {section === 'home' && <div className={'reading-actions' + (prefs.immersiveMode && immersiveHidden ? ' immersive-hidden' : '')}><m3e-toolbar className="reading-toolbar" variant="vibrant" shape="rounded" elevated>
      {article && <m3e-icon-button title="Back" aria-label="Back" onClick={back}><m3e-icon variant="rounded" name="arrow_back" /></m3e-icon-button>}
      <m3e-icon-button title="Article language" aria-label="Article language" disabled={Boolean(article && articleLanguages.length === 0)} onClick={() => article ? window.dispatchEvent(new CustomEvent('wikireader:show-languages')) : setShowGlobalLanguagePicker(true)}><m3e-icon variant="rounded" name="translate" /></m3e-icon-button>
      <m3e-icon-button title="Share article" aria-label="Share article" disabled={!article} onClick={() => void shareArticle()}><m3e-icon variant="rounded" name="share" /></m3e-icon-button>
      <m3e-icon-button title={isSaved ? 'Remove saved article' : 'Save article'} aria-label={isSaved ? 'Remove saved article' : 'Save article'} selected={isSaved} disabled={!article} onClick={toggleSaved}><m3e-icon variant="rounded" name={isSaved ? 'download_done' : 'download'} filled={isSaved} /></m3e-icon-button>
      <m3e-icon-button title="Scroll to top" aria-label="Scroll to top" onClick={() => { const pane = document.querySelector<HTMLElement>('m3e-content-pane'); const scroller = pane?.shadowRoot?.querySelector<HTMLElement>('.scroll-container') || pane; scroller?.scrollTo({ top: 0, behavior: 'smooth' }); }}><m3e-icon variant="rounded" name="arrow_upward" /></m3e-icon-button>
      <m3e-icon-button title="Random article" aria-label="Random article" onClick={() => void randomArticle()}><m3e-icon variant="rounded" name="shuffle" /></m3e-icon-button>
    </m3e-toolbar><m3e-fab className="reading-search-fab" variant="tertiary-container" size="small" aria-label="Search Wikipedia" title="Search Wikipedia" onClick={focusSearch}><m3e-icon variant="rounded" name="search" /></m3e-fab></div>}
  </m3e-theme>;
}
 
function ViewsSparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values), range = Math.max(1, max - min);
  const points = values.map((value, index) => ({x:2 + index * 92 / (values.length - 1), y:28 - ((value - min) / range) * 24}));
  const path = points.reduce((result, point, index) => {
    if (index === 0) return 'M ' + point.x + ' ' + point.y;
    const previous = points[index - 1], midpoint = (previous.x + point.x) / 2;
    return result + ' C ' + midpoint + ' ' + previous.y + ', ' + midpoint + ' ' + point.y + ', ' + point.x + ' ' + point.y;
  }, '');
  return <svg width="96" height="32" viewBox="0 0 96 32" role="img" aria-label="Article views over time"><path d={path} fill="none" stroke="var(--md-sys-color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function HomeScreen({ feed, loading, onOpen, onRandom, enabled, wide, expanded }: { feed: { featured: Page | null; trending: Page[]; image: FeedImage | null; news: FeedNews[]; onthisday: FeedOnThisDay[] }; loading: boolean; onOpen: (title: string) => void; onRandom: () => void; enabled: boolean; wide: boolean; expanded: boolean }) {
  const [trendingPage, setTrendingPage] = useState(0);
  useEffect(() => setTrendingPage(0), [feed.trending.length, feed.featured?.title]);
  const pages = Math.max(1, Math.ceil(feed.trending.length / 5));
  const visible = feed.trending.slice(trendingPage * 5, trendingPage * 5 + 5);
  const today = new Date().toLocaleDateString(undefined, { dateStyle: 'long' });
  return <div className="home-feed">
    {!enabled && <m3e-card variant="filled"><m3e-list slot="content" variant="segmented"><m3e-list-item>Article feed is disabled in Settings.</m3e-list-item></m3e-list></m3e-card>}
    {loading && enabled && <m3e-list variant="segmented"><m3e-list-item><m3e-circular-progress-indicator indeterminate />Loading today's articles…</m3e-list-item></m3e-list>}
    {enabled && feed.featured && <section className="feed-section">
      <m3e-heading level="2" variant="headline" size="medium" style={{padding:'16px 16px 0'}}>Featured article</m3e-heading>
      <m3e-heading level="6" variant="label" size="medium" style={{padding:'0 16px'}}>{today}</m3e-heading>
      <m3e-card variant="filled" actionable orientation={expanded ? 'horizontal' : 'vertical'} onClick={() => onOpen(feed.featured?.title.replaceAll('_', ' ') || '')} style={{ '--m3e-card-container-color': 'var(--md-sys-color-surface-container)', width:'calc(100% - 32px)', margin:'8px 16px' } as React.CSSProperties}>
        {feed.featured.thumbnail?.source && <img slot="header" src={feed.featured.thumbnail.source} alt={feed.featured.title} width={feed.featured.thumbnail.width} height={feed.featured.thumbnail.height} loading="lazy" style={expanded ? { display:'block', width:'50%', maxWidth:'50%', minWidth:0, height:'100%', objectFit:'cover', flex:'0 0 50%' } : { display:'block', width:'100%', maxWidth:'100%', height:'auto', maxHeight:'420px', objectFit:'cover' }} />}
        <div slot="content" className="feed-card-content" style={expanded ? { width:'50%', maxWidth:'50%', minWidth:0, flex:'1 1 50%', boxSizing:'border-box' } : undefined}>
          <m3e-heading level="3" variant="headline" size="medium" style={{ fontFamily: 'serif' }}>{feed.featured.title}</m3e-heading>
          {feed.featured.description && <p className="feed-card-description">{feed.featured.description}</p>}
          {feed.featured.extract && <p className="feed-card-extract feed-featured-extract" style={{ display:'-webkit-box', WebkitBoxOrient:'vertical', WebkitLineClamp:5, overflow:'hidden' }}>{feed.featured.extract}</p>}
        </div>
      </m3e-card>
    </section>}
    {enabled && feed.trending.length > 0 && <section className="feed-section">
      <m3e-heading level="3" variant="title" size="large" style={{padding:'24px 16px 0'}}>Trending articles</m3e-heading>
      <m3e-heading level="6" variant="label" size="medium" style={{padding:'0 16px'}}>Top articles of the day</m3e-heading>
      <m3e-list variant="segmented" style={{margin:'0 16px'}}>
        {visible.map(item => <m3e-list-item-button key={item.pageid ?? item.title} onClick={() => onOpen(item.title.replaceAll('_', ' '))}>
          <span>{item.title.replaceAll('_', ' ')}</span>
          <div slot="supporting-text" style={{display:'flex',flexDirection:'column',gap:'4px',minWidth:0}}>
            <span>{item.description || item.extract || ''}</span>
            <div style={{display:'flex',alignItems:'center',gap:'8px',minWidth:0}}>
              {item.viewHistory && item.viewHistory.length > 1 && <ViewsSparkline values={item.viewHistory.map(point=>point.views ?? 0)} />}
              <span>{item.views ? new Intl.NumberFormat(undefined,{notation:'compact'}).format(item.views) + ' views today' : ''}</span>
            </div>
          </div>
          {item.thumbnail?.source && <img className="thumbnail-square" style={{'--thumbnail-size':'80px'} as React.CSSProperties} slot="trailing" src={item.thumbnail.source} alt="" width="80" height="80" loading="lazy" />}
        </m3e-list-item-button>)}
      </m3e-list>
      {pages > 1 && <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:'8px',padding:'8px 16px'}}>
        <m3e-icon-button title="Previous trending page" aria-label="Previous trending page" disabled={trendingPage===0} onClick={()=>setTrendingPage(v=>Math.max(0,v-1))}><m3e-icon variant="rounded" name="keyboard_arrow_left" /></m3e-icon-button>
        <span>Page {trendingPage+1} of {pages}</span>
        <m3e-icon-button title="Next trending page" aria-label="Next trending page" disabled={trendingPage===pages-1} onClick={()=>setTrendingPage(v=>Math.min(pages-1,v+1))}><m3e-icon variant="rounded" name="keyboard_arrow_right" /></m3e-icon-button>
      </div>}
    </section>}
    {enabled && (feed.image?.thumbnail?.source || feed.image?.image?.source) && <section className="feed-section">
      <m3e-heading level="3" variant="title" size="large" style={{padding:'24px 16px 0'}}>Picture of the day</m3e-heading>
      <m3e-card variant="filled" orientation={expanded ? 'horizontal' : 'vertical'} style={{ '--m3e-card-container-color': 'var(--md-sys-color-surface-container)', width:'calc(100% - 32px)', margin:'8px 16px' } as React.CSSProperties}>
        <img slot="header" src={(feed.image.thumbnail || feed.image.image)?.source} alt={feed.image.description?.text || feed.image.title || 'Picture of the day'} width={(feed.image.thumbnail || feed.image.image)?.width} height={(feed.image.thumbnail || feed.image.image)?.height} loading="lazy" style={expanded ? { display:'block', width:'50%', maxWidth:'50%', minWidth:0, height:'100%', objectFit:'cover', flex:'0 0 50%' } : { display:'block', width:'100%', maxWidth:'100%', height:'auto', maxHeight:'420px', objectFit:'cover' }} />
        <div slot="content" className="feed-card-content" style={expanded ? { width:'50%', maxWidth:'50%', minWidth:0, flex:'1 1 50%', boxSizing:'border-box' } : undefined}>
          {feed.image.description?.text && <p className="feed-card-extract">{feed.image.description.text}</p>}
          {(feed.image.artist?.name || feed.image.artist?.text) && <p className="feed-card-description">{feed.image.artist.name || feed.image.artist.text}{feed.image.credit?.text ? ' ('+feed.image.credit.text.split(';')[0]+')' : ''}</p>}
        </div>
      </m3e-card>
    </section>}
    {enabled && feed.news.length > 0 && <section className="feed-section">
      <m3e-heading level="3" variant="title" size="large" style={{padding:'24px 16px 0'}}>In the news</m3e-heading>
      {feed.news.map((item,index)=><m3e-card key={index} variant="filled">
        {item.links?.find(link=>link.thumbnail?.source)?.thumbnail?.source && <img slot="header" src={item.links.find(link=>link.thumbnail?.source)?.thumbnail?.source} alt="" loading="lazy" />}
        <m3e-list slot="content" variant="segmented">
          <m3e-list-item><WikiFeedStory html={item.story || item.links?.[0]?.title || 'News story'} onOpen={onOpen} /></m3e-list-item>
          {item.links?.slice(0,3).map(link=><m3e-list-item-button key={link.title} onClick={()=>onOpen(link.title)}>{link.title}<m3e-icon slot="trailing" variant="rounded" name="chevron_right"/></m3e-list-item-button>)}
        </m3e-list>
      </m3e-card>)}
    </section>}
    {enabled && feed.onthisday.length > 0 && <section className="feed-section">
      <m3e-heading level="3" variant="title" size="large" style={{padding:'24px 16px 0'}}>On this day</m3e-heading>
      <m3e-list variant="segmented">
        {feed.onthisday.map((item,index)=><m3e-list-item key={index}>
          <span slot="overline">{item.year ?? ''}</span><span>{item.text || 'Historical event'}</span>
          {item.pages?.slice(0,2).map(page=><m3e-button key={page.title} variant="text" onClick={()=>onOpen(page.title)}>{page.title}</m3e-button>)}
        </m3e-list-item>)}
      </m3e-list>
    </section>}
    {!loading && enabled && !feed.featured && feed.trending.length===0 && !feed.image && feed.news.length===0 && feed.onthisday.length===0 && <m3e-card variant="filled"><m3e-list slot="content" variant="segmented"><m3e-list-item><m3e-icon slot="leading" variant="rounded" name="error" /><span>Today's articles are unavailable</span><span slot="supporting-text">Search Wikipedia or open a random article.</span><m3e-button slot="trailing" variant="filled" onClick={onRandom}>Random</m3e-button></m3e-list-item></m3e-list></m3e-card>}
  </div>;
}
function WikiFeedStory({ html, onOpen }: { html: string; onOpen: (title: string) => void }) {
  const nodes = useMemo(() => {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const convert = (node: Node, key: string): React.ReactNode => {
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
      if (!(node instanceof HTMLElement)) return null;
      const tag = node.tagName.toLowerCase();
      const children = Array.from(node.childNodes).map((child, index) => convert(child, key + '-' + index));
      if (tag === 'a') {
        const href = node.getAttribute('href') || '';
        const rawTitle = href.startsWith('./') ? href.slice(2).split('#')[0] : node.getAttribute('title') || node.textContent || '';
        let title = rawTitle;
        try { title = decodeURIComponent(rawTitle).replaceAll('_', ' '); } catch { title = rawTitle.replaceAll('_', ' '); }
        return <a key={key} href="#" onClick={event => { event.preventDefault(); if (title) onOpen(title); }}>{children}</a>;
      }
      if (tag === 'b' || tag === 'strong') return <strong key={key}>{children}</strong>;
      if (tag === 'i' || tag === 'em') return <em key={key}>{children}</em>;
      if (tag === 'br') return <span key={key}> </span>;
      return <React.Fragment key={key}>{children}</React.Fragment>;
    };
    return Array.from(document.body.childNodes).map((node, index) => convert(node, String(index)));
  }, [html, onOpen]);
  return <>{nodes}</>;
}

function ArticleScreen({ article, html, loading, saved, onBack, onSave, fontSize, dataSaver, expandedSections, fontStyle, imageBackground, renderMath, languages, onChooseLanguage }: { article: Page; html: string; loading: boolean; saved: boolean; onBack: () => void; onSave: () => void; fontSize: number; dataSaver: boolean; expandedSections: boolean; fontStyle: string; imageBackground: boolean; renderMath: boolean; languages: ArticleLanguage[]; onChooseLanguage: (lang: string, title: string) => void }) {
  const [showLanguages, setShowLanguages] = useState(false);
  const [languageQuery, setLanguageQuery] = useState('');
  useEffect(() => {
    const show = () => setShowLanguages(true);
    window.addEventListener('wikireader:show-languages', show);
    return () => window.removeEventListener('wikireader:show-languages', show);
  }, []);
  const headings = useMemo(() => {
    if (!html) return [];
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return Array.from(doc.querySelectorAll('h2,h3')).map((heading, index) => ({ id: heading.id || 'heading-' + index, text: heading.textContent?.replace('[edit]', '').trim() || '' })).filter(item => item.text);
  }, [html]);
  return <>
    <m3e-heading level="1" variant="display" size="small" style={{ fontFamily: 'serif', padding: '16px 16px 0' }}>{article.title}</m3e-heading>
    {article.description && <p style={{margin:'4px 16px 16px',color:'var(--md-sys-color-on-surface-variant)',fontFamily:'serif',fontSize:'1rem'}}>{article.description}</p>}
    {showLanguages && <m3e-card variant="filled"><m3e-list slot="content" variant="standard"><m3e-list-item>Available article languages</m3e-list-item><m3e-list-item><m3e-search-bar clearable><m3e-icon slot="leading" variant="rounded" name="search"/><input slot="input" aria-label="Search article languages" placeholder="Find language or title" value={languageQuery} onChange={event=>setLanguageQuery(event.target.value)}/></m3e-search-bar></m3e-list-item>{languages.filter(x=>(x.name+' '+x.lang+' '+x.title).toLowerCase().includes(languageQuery.toLowerCase())).map(x=><m3e-list-item-button key={x.lang} selected={x.lang===article.lang} onClick={()=>{setShowLanguages(false);setLanguageQuery('');onChooseLanguage(x.lang,x.title);}}><m3e-icon slot="leading" variant="rounded" name={x.lang===article.lang?'check_circle':'language'}/><span>{x.name||x.lang}</span><span slot="supporting-text">{x.title} · {x.lang}</span></m3e-list-item-button>)}</m3e-list></m3e-card>}

    {loading&&<m3e-list-item><m3e-circular-progress-indicator indeterminate/>Loading full article…</m3e-list-item>}
    {html&&<ArticleRenderer html={html} lang={article.lang||'en'} dataSaver={dataSaver} expandedSections={expandedSections} fontSize={fontSize} fontStyle={fontStyle} imageBackground={imageBackground} renderMath={renderMath} pageImageUri={article.thumbnail?.source} onLinkClick={title=>{const target=title.trim();if(target)window.dispatchEvent(new CustomEvent('wikireader:open-article',{detail:{title:target,lang:article.lang||'en'}}));}}/>}
    {!loading&&!html&&<m3e-list-item>The full article could not be loaded. A cached copy may be available when you reconnect.</m3e-list-item>}
  </>;
}

function HistoryScreen({ entries, total, onOpen }: { entries: Entry[]; total: number; onOpen: (entry: Entry) => void }) {
  const groups = useMemo(() => {
    const grouped = new Map<string, Entry[]>();
    for (const entry of entries) {
      const date = new Date(entry.visited).toLocaleDateString(undefined, { dateStyle: 'long' });
      const items = grouped.get(date) || [];
      items.push(entry);
      grouped.set(date, items);
    }
    return Array.from(grouped.entries());
  }, [entries]);
  return <div style={{display:'flex',flexDirection:'column',gap:'8px',minWidth:0}}>
    <m3e-heading level="1" variant="display" size="small" style={{padding:'8px 16px 0'}}>History</m3e-heading>
    {entries.length === 0
      ? <m3e-list variant="segmented" style={{margin:'0 16px'}}><m3e-list-item><m3e-icon slot="leading" variant="rounded" name="history" /><span>{total === 0 ? 'No reading history' : 'No matching articles'}</span><span slot="supporting-text">{total === 0 ? 'Articles you read will appear here.' : 'Try a different search term.'}</span></m3e-list-item></m3e-list>
      : groups.map(([date, items]) => <section key={date} style={{display:'flex',flexDirection:'column',gap:'2px',minWidth:0}}>
          <m3e-heading level="6" variant="title" size="small" style={{padding:'14px 32px 8px'}}>{date}</m3e-heading>
          <m3e-list variant="segmented" style={{margin:'0 16px'}}>
            {items.map(entry => <m3e-list-item-button key={entry.lang + ':' + entry.title + ':' + entry.visited} onClick={() => onOpen(entry)}>
              {entry.thumbnail && <img className="thumbnail-square" slot="leading" src={entry.thumbnail} alt="" width="64" height="64" loading="lazy" />}
              <span>{entry.title}</span>
              {entry.description && <span slot="supporting-text">{entry.description}</span>}
              <span slot="trailing">{new Date(entry.visited).toLocaleTimeString(undefined, {hour:'numeric',minute:'2-digit'})}</span>
            </m3e-list-item-button>)}
          </m3e-list>
        </section>)
    }
  </div>;
}

function SavedArticlesScreen({ entries, total, languageCount, onOpen }: { entries: Entry[]; total: number; languageCount: number; onOpen: (entry: Entry) => void }) {
  return <div style={{ display:'flex', flexDirection:'column', gap:'8px', minWidth:0 }}>
    <m3e-heading level="1" variant="display" size="small" style={{ padding:'8px 16px 0' }}>Saved articles</m3e-heading>
    <m3e-heading level="6" variant="title" size="small" style={{ padding:'0 16px 8px' }}>{total} articles, {languageCount} languages</m3e-heading>
    {entries.length === 0
      ? <m3e-list variant="segmented" style={{ margin:'0 16px' }}><m3e-list-item><m3e-icon slot="leading" variant="rounded" name="download" /><span>No saved articles</span><span slot="supporting-text">Articles you save will appear here.</span></m3e-list-item></m3e-list>
      : <m3e-list variant="segmented" style={{ margin:'0 16px' }}>
          {entries.map(entry => <m3e-list-item-button key={entry.lang + ':' + entry.title} onClick={() => onOpen(entry)} style={{ minWidth:0 }}>
            {entry.thumbnail && <img className="thumbnail-square" slot="leading" src={entry.thumbnail} alt="" width="64" height="64" loading="lazy" />}
            <span>{entry.title.replaceAll('_', ' ')}</span>
            {entry.description && <span slot="supporting-text">{entry.description}</span>}
          </m3e-list-item-button>)}
        </m3e-list>}
  </div>;
}

function SettingsScreen({ prefs, update, languageFilter, setLanguageFilter, onClearData, onReset }: { prefs: Preferences; update: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void; languageFilter: string; setLanguageFilter: (value: string) => void; onClearData: () => void; onReset: () => void }) {
  const [themeOpen,setThemeOpen]=useState(false),[colorsOpen,setColorsOpen]=useState(false),[languageOpen,setLanguageOpen]=useState(false),[clearOpen,setClearOpen]=useState(false),[resetOpen,setResetOpen]=useState(false);
  useEffect(()=>{const reset=()=>setResetOpen(true);window.addEventListener('wikireader:reset-settings',reset);return()=>window.removeEventListener('wikireader:reset-settings',reset);},[]);
  const themes=[['auto','System default'],['light','Light'],['dark','Dark']] as const;
  const colors=['#feb4a7','#ffb3c0','#fcaaff','#b9c3ff','#62d3ff','#44d9f1','#52dbc9','#78dd77','#9fd75c','#c1d02d','#fabd00','#ffb86e','#ffffff'];
  const switches:{key:'dataSaver'|'feedEnabled'|'expandedSections'|'imageBackground'|'immersiveMode'|'renderMath'|'browsingHistory'|'searchHistory';label:string;desc:string}[]=[
    {key:'dataSaver',label:'Data saver',desc:'Avoid loading images to reduce data usage.'},{key:'feedEnabled',label:'Home feed',desc:'Show featured and trending articles on Home.'},{key:'expandedSections',label:'Expanded sections',desc:'Expand article sections by default.'},{key:'imageBackground',label:'Image background',desc:'Display a surface behind article images.'},{key:'immersiveMode',label:'Immersive mode',desc:'Hide the top app bar and floating action buttons while scrolling.'},{key:'renderMath',label:'Render mathematical notation',desc:'Display equations in article content.'},{key:'browsingHistory',label:'Browsing history',desc:'Remember articles you open.'},{key:'searchHistory',label:'Search history',desc:'Keep recent search terms on this device.'}];
  return <>
    <m3e-list variant="segmented">
      <m3e-list-item-button onClick={()=>setColorsOpen(true)}><m3e-icon slot="leading" variant="rounded" name="palette"/><span>Color scheme</span><span slot="supporting-text">{prefs.colorScheme}</span><m3e-icon slot="trailing" variant="rounded" name="chevron_right"/></m3e-list-item-button>
      <m3e-list-item-button onClick={()=>setThemeOpen(true)}><m3e-icon slot="leading" variant="rounded" name="brightness_6"/><span>Theme</span><span slot="supporting-text">{themes.find(x=>x[0]===prefs.theme)?.[1]}</span><m3e-icon slot="trailing" variant="rounded" name="chevron_right"/></m3e-list-item-button>
      <m3e-list-item><m3e-icon slot="leading" variant="rounded" name="brightness_6"/><span>Black theme</span><span slot="supporting-text">Use a pure black dark theme.</span><m3e-switch slot="trailing" checked={prefs.blackTheme} onChange={()=>update('blackTheme',!prefs.blackTheme)}/></m3e-list-item>
    </m3e-list>
    <m3e-list variant="segmented">
      <m3e-list-item-button onClick={()=>setLanguageOpen(true)}><m3e-icon slot="leading" variant="rounded" name="translate"/><span>Wikipedia language</span><span slot="supporting-text">{languages.find(x=>x[0]===prefs.lang)?.[1] || prefs.lang} ({prefs.lang})</span><m3e-icon slot="trailing" variant="rounded" name="chevron_right"/></m3e-list-item-button>
      <m3e-list-item><m3e-icon slot="leading" variant="rounded" name="text_fields"/><span>Font style</span><m3e-button-group slot="trailing" variant="connected"><m3e-button variant="tonal" shape="square" toggle aria-pressed={prefs.fontStyle==='sans'} onClick={()=>update('fontStyle','sans')}>Sans-serif</m3e-button><m3e-button variant="tonal" shape="square" toggle aria-pressed={prefs.fontStyle==='serif'} onClick={()=>update('fontStyle','serif')}>Serif</m3e-button></m3e-button-group></m3e-list-item>
      <m3e-list-item><m3e-icon slot="leading" variant="rounded" name="format_size"/><span>Article font size</span><span slot="supporting-text">{prefs.fontSize} sp</span></m3e-list-item>
      <m3e-list-item><m3e-slider min={10} max={22} step={1} discrete labelled onInput={event=>{const thumb=(event.currentTarget as HTMLElement).querySelector<HTMLElement & {value?:number}>('m3e-slider-thumb');const value=Number(thumb?.value ?? thumb?.getAttribute('value') ?? prefs.fontSize);if(Number.isFinite(value))update('fontSize',Math.max(10,Math.min(22,Math.round(value))));}}><m3e-slider-thumb value={prefs.fontSize}/></m3e-slider></m3e-list-item>
      </m3e-list>
      <m3e-list variant="segmented">
      {switches.map(item=><m3e-list-item key={item.key}><m3e-icon slot="leading" variant="rounded" name="tune"/><span>{item.label}</span><span slot="supporting-text">{item.desc}</span><m3e-switch slot="trailing" checked={Boolean(prefs[item.key])} disabled={item.key==='feedEnabled'&&prefs.dataSaver} onChange={()=>update(item.key,!prefs[item.key] as Preferences[typeof item.key])}/></m3e-list-item>)}
      <m3e-list-item><m3e-icon slot="leading" variant="rounded" name="delete"/><span>Local data</span><span slot="supporting-text">Clear saved articles, history, searches, and cached pages from this device.</span><m3e-button slot="trailing" variant="filled" onClick={()=>setClearOpen(true)}>Clear data</m3e-button></m3e-list-item>
    </m3e-list>
    <m3e-list variant="segmented">
      <m3e-list-item><m3e-icon slot="leading" variant="rounded" name="info"/><span>Set as default</span><span slot="supporting-text">Configure your desktop system to open Wikipedia links with WikiReader.</span><m3e-button slot="trailing" variant="text" onClick={()=>window.open('https://gist.github.com/nsh07/ed7571f3e2014b412037626a39d68ecd','_blank','noopener,noreferrer')}>Instructions</m3e-button></m3e-list-item>
    </m3e-list>
    {themeOpen && <m3e-dialog open dismissible close-label="Close theme options"><span slot="header">Theme</span><m3e-list variant="segmented">{themes.map(x=><m3e-list-item-button key={x[0]} selected={prefs.theme===x[0]} onClick={()=>update('theme',x[0])}><m3e-icon slot="leading" variant="rounded" name={prefs.theme===x[0]?'radio_button_checked':'radio_button_unchecked'}/>{x[1]}</m3e-list-item-button>)}</m3e-list><m3e-list-item slot="actions"><m3e-button variant="text" onClick={()=>setThemeOpen(false)}>Close</m3e-button></m3e-list-item></m3e-dialog>}
    {colorsOpen && <m3e-dialog open dismissible close-label="Close color schemes"><span slot="header">Choose color scheme</span><div className="color-scheme-options">{colors.slice(0,12).map(color=><m3e-icon-button key={color} variant="filled" aria-label={'Choose color scheme ' + color} title={color} selected={prefs.colorScheme===color} style={{ '--m3e-icon-button-container-color': color, '--m3e-filled-icon-button-container-color': color } as React.CSSProperties} onClick={()=>update('colorScheme',color)}><m3e-icon variant="rounded" name={prefs.colorScheme===color?'check':'circle'} /></m3e-icon-button>)}<m3e-icon-button variant="filled" aria-label="Dynamic color" title="Dynamic color" selected={prefs.colorScheme==='#ffffff'} style={{ '--m3e-icon-button-container-color': '#ffffff', '--m3e-filled-icon-button-container-color': '#ffffff' } as React.CSSProperties} onClick={()=>update('colorScheme','#ffffff')}><m3e-icon variant="rounded" name={prefs.colorScheme==='#ffffff'?'check':'palette'} /></m3e-icon-button></div><m3e-list-item slot="actions"><m3e-button variant="text" onClick={()=>setColorsOpen(false)}>Done</m3e-button></m3e-list-item></m3e-dialog>}
    <LanguagePickerDialog open={languageOpen} filter={languageFilter} setFilter={setLanguageFilter} currentLang={prefs.lang} title="Wikipedia language" onClose={()=>setLanguageOpen(false)} onChoose={target=>{update('lang',target);setLanguageFilter('');setLanguageOpen(false);}}/>
    {clearOpen && <m3e-dialog open dismissible close-label="Cancel clearing data"><span slot="header">Clear local data?</span><m3e-list-item>This removes saved articles, history, search history, and cached article pages.</m3e-list-item><m3e-list-item slot="actions"><m3e-button variant="text" onClick={()=>setClearOpen(false)}>Cancel</m3e-button><m3e-button variant="filled" onClick={()=>{onClearData();setClearOpen(false);}}>Clear data</m3e-button></m3e-list-item></m3e-dialog>}
    {resetOpen && <m3e-dialog open dismissible close-label="Cancel resetting settings"><span slot="header">Reset settings?</span><m3e-list-item>Preferences return to defaults. Saved articles and history are kept.</m3e-list-item><m3e-list-item slot="actions"><m3e-button variant="text" onClick={()=>setResetOpen(false)}>Cancel</m3e-button><m3e-button variant="filled" onClick={()=>{onReset();setResetOpen(false);}}>Reset</m3e-button></m3e-list-item></m3e-dialog>}
  </>;
}
function LanguagePickerDialog({open,filter,setFilter,currentLang,title,onClose,onChoose}:{open:boolean;filter:string;setFilter:(value:string)=>void;currentLang:string;title:string;onClose:()=>void;onChoose:(lang:string)=>void}) {
 return <m3e-dialog open={open} dismissible close-label="Close language chooser"><span slot="header">{title}</span><m3e-list-item><m3e-search-bar clearable><m3e-icon slot="leading" variant="rounded" name="search"/><input slot="input" aria-label="Find Wikipedia language" placeholder="Search languages" value={filter} onChange={event=>setFilter(event.target.value)}/></m3e-search-bar></m3e-list-item><m3e-list variant="segmented">{languages.filter(x=>(x[0]+' '+x[1]).toLowerCase().includes(filter.toLowerCase())).map(x=><m3e-list-item-button key={x[0]} selected={currentLang===x[0]} onClick={()=>onChoose(x[0])}><m3e-icon slot="leading" variant="rounded" name={currentLang===x[0]?'radio_button_checked':'radio_button_unchecked'}/><span>{x[1]}</span><span slot="supporting-text">{x[0]}</span></m3e-list-item-button>)}</m3e-list><m3e-list-item slot="actions"><m3e-button variant="text" onClick={onClose}>Close</m3e-button></m3e-list-item></m3e-dialog>;
}

function AboutScreen() {
  return <div className="about-page">
    <m3e-card variant="filled"><div slot="content">
      <m3e-list variant="standard"><m3e-list-item><m3e-icon slot="leading" variant="rounded" name="menu_book" filled/><span>WikiReader</span><span slot="supporting-text">A simple reader for Wikipedia.</span></m3e-list-item></m3e-list>
      <m3e-heading level="6" variant="label" size="large">A focused Wikipedia reading experience</m3e-heading>
    </div></m3e-card>
    <m3e-list variant="segmented">
      <m3e-list-item><m3e-icon variant="rounded" slot="leading" name="info"/><span>Version</span><span slot="supporting-text">2.5.5 desktop</span></m3e-list-item>
      <m3e-list-item-button onClick={() => window.open('https://github.com/nsh07/WikiReader', '_blank', 'noopener,noreferrer')}><m3e-icon variant="rounded" slot="leading" name="code"/><span>Source code</span><span slot="supporting-text">GitHub</span><m3e-icon slot="trailing" variant="rounded" name="open_in_new"/></m3e-list-item-button>
      <m3e-list-item-button onClick={() => window.open('https://github.com/nsh07/WikiReader/blob/main/LICENSE', '_blank', 'noopener,noreferrer')}><m3e-icon variant="rounded" slot="leading" name="gavel"/><span>License</span><span slot="supporting-text">GPL v3.0</span><m3e-icon slot="trailing" variant="rounded" name="open_in_new"/></m3e-list-item-button>
      <m3e-list-item-button onClick={() => window.open('https://github.com/nsh07/WikiReader/releases', '_blank', 'noopener,noreferrer')}><m3e-icon variant="rounded" slot="leading" name="system_update_alt"/><span>Releases</span><span slot="supporting-text">Download the latest version</span><m3e-icon slot="trailing" variant="rounded" name="open_in_new"/></m3e-list-item-button>
      <m3e-list-item-button onClick={() => window.open('https://hosted.weblate.org/engage/wikireader/', '_blank', 'noopener,noreferrer')}><m3e-icon variant="rounded" slot="leading" name="translate"/><span>Translate WikiReader</span><span slot="supporting-text">Help translate the app.</span><m3e-icon slot="trailing" variant="rounded" name="open_in_new"/></m3e-list-item-button>
    </m3e-list>
    <m3e-heading level="6" variant="label" size="large">Author</m3e-heading>
    <m3e-list variant="segmented">
      <m3e-list-item-button onClick={() => window.open('https://github.com/nsh07', '_blank', 'noopener,noreferrer')}><m3e-icon variant="rounded" slot="leading" name="code"/><span>Nishant Mishra</span><span slot="supporting-text">Other projects</span><m3e-icon slot="trailing" variant="rounded" name="open_in_new"/></m3e-list-item-button>
      <m3e-list-item-button onClick={() => window.open('https://github.com/sponsors/nsh07', '_blank', 'noopener,noreferrer')}><m3e-icon variant="rounded" slot="leading" name="favorite"/><span>Donate</span><span slot="supporting-text">Support my work</span><m3e-icon slot="trailing" variant="rounded" name="open_in_new"/></m3e-list-item-button>
    </m3e-list>
    <m3e-heading level="6" variant="label" size="large">Wikipedia</m3e-heading>
    <m3e-list variant="segmented">
      <m3e-list-item-button onClick={() => window.open('https://wikipedia.org', '_blank', 'noopener,noreferrer')}><m3e-icon variant="rounded" slot="leading" name="public"/><span>Wikipedia</span><span slot="supporting-text">Article content and media are supplied by Wikipedia and Wikimedia projects.</span><m3e-icon slot="trailing" variant="rounded" name="open_in_new"/></m3e-list-item-button>
      <m3e-list-item-button onClick={() => window.open('https://wikimediafoundation.org/support/', '_blank', 'noopener,noreferrer')}><m3e-icon variant="rounded" slot="leading" name="volunteer_activism"/><span>Support Wikipedia</span><span slot="supporting-text">Donate to the Wikimedia Foundation</span><m3e-icon slot="trailing" variant="rounded" name="open_in_new"/></m3e-list-item-button>
    </m3e-list>
  </div>;
}