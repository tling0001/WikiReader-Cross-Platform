import { useCallback, useEffect, useMemo, useState } from 'react';
import ArticleRenderer from './ArticleRenderer';

type Page = { title: string; description?: string; extract?: string; thumbnail?: { source: string; width?: number; height?: number }; pageid?: number; lang?: string };
type Entry = { title: string; lang: string; visited: number; description?: string; thumbnail?: string };
type ArticleLanguage = { lang: string; title: string; name?: string };
type Section = 'home' | 'history' | 'saved' | 'settings' | 'about';
type Preferences = { theme: 'auto' | 'light' | 'dark'; lang: string; fontStyle: string; colorScheme: string; fontSize: number; blackTheme: boolean; dataSaver: boolean; feedEnabled: boolean; expandedSections: boolean; imageBackground: boolean; immersiveMode: boolean; renderMath: boolean; browsingHistory: boolean; searchHistory: boolean };
const defaults: Preferences = { theme: 'auto', lang: 'en', fontStyle: 'sans', colorScheme: '#6750a4', fontSize: 16, blackTheme: false, dataSaver: false, feedEnabled: true, expandedSections: false, imageBackground: false, immersiveMode: true, renderMath: true, browsingHistory: true, searchHistory: true };
const readStore = <T,>(key: string, fallback: T): T => { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } };
const writeStore = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage may be unavailable. */ } };
type CachedArticle = { html: string; savedAt: number };
const cacheKey = 'wr-article-cache';
const getCachedArticle = (lang: string, title: string) => readStore<Record<string, CachedArticle>>(cacheKey, {})[lang + ':' + title]?.html ?? '';
const cacheArticle = (lang: string, title: string, html: string) => { if (!html || html.length > 350000) return; const cache = readStore<Record<string, CachedArticle>>(cacheKey, {}); cache[lang + ':' + title] = { html, savedAt: Date.now() }; writeStore(cacheKey, Object.fromEntries(Object.entries(cache).sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, 5))); };
const titleToPath = (title: string) => encodeURIComponent(title.replaceAll(' ', '_'));
const api = async <T,>(url: string): Promise<T> => { const response = await fetch(url, { headers: { 'Api-User-Agent': 'WikiReader/2.5.5 (desktop reader)' } }); if (!response.ok) throw new Error('Wikipedia returned ' + response.status); return response.json() as Promise<T>; };
const languages = [['en','English'],['es','Español'],['fr','Français'],['de','Deutsch'],['it','Italiano'],['pt','Português'],['ja','日本語'],['zh','中文'],['ru','Русский'],['ar','العربية'],['hi','हिन्दी'],['ko','한국어'],['nl','Nederlands'],['pl','Polski'],['sv','Svenska'],['uk','Українська'],['fa','فارسی'],['tr','Türkçe'],['vi','Tiếng Việt'],['id','Bahasa Indonesia']] as const;

export default function App() {
  const [section, setSection] = useState<Section>('home');
  const [prefs, setPrefs] = useState<Preferences>(() => ({ ...defaults, ...readStore<Partial<Preferences>>('wr-preferences', {}) }));
  const [history, setHistory] = useState<Entry[]>(() => readStore('wr-history', []));
  const [saved, setSaved] = useState<Entry[]>(() => readStore('wr-saved', []));
  const [searchHistory, setSearchHistory] = useState<string[]>(() => readStore('wr-search-history', []));
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Page[]>([]);
  const [searching, setSearching] = useState(false);
  const [feed, setFeed] = useState<Page[]>([]);
  const [article, setArticle] = useState<Page | null>(null);
  const [articleHtml, setArticleHtml] = useState('');
  const [articleLanguages, setArticleLanguages] = useState<ArticleLanguage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [stack, setStack] = useState<string[]>([]);
  const [showContents, setShowContents] = useState(false);
  const [languageFilter, setLanguageFilter] = useState('');
  const [listFilter, setListFilter] = useState('');
  const [portrait, setPortrait] = useState(() => typeof window !== 'undefined' && window.matchMedia('(orientation: portrait)').matches);
  const lang = prefs.lang;
  const update = <K extends keyof Preferences,>(key: K, value: Preferences[K]) => setPrefs(previous => ({ ...previous, [key]: value }));

  useEffect(() => {
    const query = window.matchMedia('(orientation: portrait)');
    const updateOrientation = () => setPortrait(query.matches);
    updateOrientation();
    query.addEventListener('change', updateOrientation);
    window.addEventListener('resize', updateOrientation);
    return () => { query.removeEventListener('change', updateOrientation); window.removeEventListener('resize', updateOrientation); };
  }, []);

  useEffect(() => { writeStore('wr-preferences', prefs); }, [prefs]);
  useEffect(() => { writeStore('wr-history', history); }, [history]);
  useEffect(() => { writeStore('wr-saved', saved); }, [saved]);
  useEffect(() => { writeStore('wr-search-history', searchHistory); }, [searchHistory]);

  useEffect(() => {
    if (!prefs.feedEnabled) { setFeed([]); return; }
    let active = true;
    const date = new Date().toISOString().slice(0, 10).replaceAll('-', '/');
    api<{ tfa?: Page; mostread?: { articles?: Page[] } }>('https://' + lang + '.wikipedia.org/api/rest_v1/feed/featured/' + date)
      .then(data => { if (active) setFeed([...(data.tfa ? [data.tfa] : []), ...(data.mostread?.articles ?? []).slice(0, 12)]); })
      .catch(() => { if (active) setFeed([]); });
    return () => { active = false; };
  }, [lang, prefs.feedEnabled]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) { setSuggestions([]); setSearching(false); return; }
    let active = true;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const data = await api<{ query?: { pages?: { title: string; pageid: number; thumbnail?: { source: string }; terms?: { description?: string[] } }[] } }>('https://' + lang + '.wikipedia.org/w/api.php?action=query&generator=prefixsearch&gpssearch=' + encodeURIComponent(term) + '&gpslimit=8&prop=pageimages%7Cpageterms&piprop=thumbnail&pithumbsize=100&wbptterms=description&format=json&formatversion=2&origin=*');
        if (active) setSuggestions((data.query?.pages ?? []).map(page => ({ title: page.title, pageid: page.pageid, thumbnail: page.thumbnail, description: page.terms?.description?.[0] })));
      } catch { if (active) setSuggestions([]); } finally { if (active) setSearching(false); }
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, lang]);

  const openArticle = useCallback(async (title: string, push = true, requestedLang = lang) => {
    setError(''); setLoading(true); setSection('home'); setQuery(''); setSuggestions([]); setShowContents(false); setArticleLanguages([]);
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
        if (response.ok) { const html = await response.text(); setArticleHtml(html); cacheArticle(requestedLang, current.title || title, html); }
        else setArticleHtml(getCachedArticle(requestedLang, current.title || title));
      } catch { setArticleHtml(getCachedArticle(requestedLang, current.title || title)); }
    } catch (reason) {
      const cached = getCachedArticle(requestedLang, title);
      if (cached) {
        setArticle({ title, lang: requestedLang }); setArticleHtml(cached);
        if (push) setStack(previous => [...previous, title]);
        if (prefs.browsingHistory) setHistory(previous => [{ title, lang: requestedLang, visited: Date.now() }, ...previous.filter(item => !(item.title === title && item.lang === requestedLang))].slice(0, 500));
      } else setError(reason instanceof Error ? reason.message : 'Could not load this article.');
    } finally { setLoading(false); }
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
  const doSearch = () => { const value = query.trim(); if (value) void openArticle(value); };
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
  const pageTitle = article?.title ?? 'WikiReader';
  const titleBySection: Record<Section, string> = { home: pageTitle, history: 'History', saved: 'Saved articles', settings: 'Settings', about: 'About WikiReader' };
  const filteredHistory = history.filter(item => (item.title + ' ' + (item.description || '')).toLowerCase().includes(listFilter.toLowerCase()));
  const filteredSaved = saved.filter(item => (item.title + ' ' + (item.description || '')).toLowerCase().includes(listFilter.toLowerCase()));
  const selectedLangName = languages.find(item => item[0] === lang)?.[1] ?? lang;

  const navigationItems = <>
    <m3e-nav-item selected={section === 'home'} onClick={() => { setSection('home'); if (!article) setStack([]); }}><m3e-icon slot="icon" variant="rounded" name="home" />Home</m3e-nav-item>
    <m3e-nav-item selected={section === 'saved'} onClick={() => { setSection('saved'); setListFilter(''); }}><m3e-icon slot="icon" variant="rounded" name="bookmark" />Saved</m3e-nav-item>
    {prefs.browsingHistory && <m3e-nav-item selected={section === 'history'} onClick={() => { setSection('history'); setListFilter(''); }}><m3e-icon slot="icon" variant="rounded" name="history" />History</m3e-nav-item>}
    <m3e-nav-item selected={section === 'settings'} onClick={() => setSection('settings')}><m3e-icon slot="icon" variant="rounded" name="settings" />Settings</m3e-nav-item>
    <m3e-nav-item selected={section === 'about'} onClick={() => setSection('about')}><m3e-icon slot="icon" variant="rounded" name="info" />About</m3e-nav-item>
  </>;

  const screenContent = <>
    <m3e-list>
      <m3e-list-item>
        <m3e-search-bar slot="leading" clearable>
          <m3e-icon variant="rounded" slot="leading" name="search" />
          <input slot="input" aria-label="Search Wikipedia" placeholder={'Search ' + selectedLangName + ' Wikipedia'} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') doSearch(); }} />
          <m3e-icon-button slot="trailing" title="Search" onClick={doSearch}><m3e-icon variant="rounded" name="arrow_forward" /></m3e-icon-button>
        </m3e-search-bar>
      </m3e-list-item>
      {query.trim().length > 1 && <m3e-list>
        {searching && <m3e-list-item><m3e-progress-indicator indeterminate />Searching Wikipedia…</m3e-list-item>}
        {suggestions.map(item => <m3e-list-item-button key={item.pageid ?? item.title} onClick={() => void openArticle(item.title)}>{item.thumbnail?.source && <img slot="leading" src={item.thumbnail.source} alt="" />}<span>{item.title}</span><span slot="supporting-text">{item.description || 'Wikipedia article'}</span><m3e-icon variant="rounded" slot="trailing" name="arrow_forward" /></m3e-list-item-button>)}
        {!searching && suggestions.length === 0 && <m3e-list-item>No matches. Press Enter to open {query}.</m3e-list-item>}
      </m3e-list>}
    </m3e-list>
    {error && <m3e-card variant="outlined"><m3e-list-item><m3e-icon variant="rounded" slot="leading" name="error" />{error}<m3e-button slot="trailing" variant="text" onClick={() => setError('')}>Dismiss</m3e-button></m3e-list-item></m3e-card>}
    {section === 'home' && (article ? <ArticleScreen article={article} html={articleHtml} loading={loading} saved={isSaved} onBack={back} onSave={toggleSaved} showContents={showContents} setShowContents={setShowContents} fontSize={prefs.fontSize} dataSaver={prefs.dataSaver} expandedSections={prefs.expandedSections} fontStyle={prefs.fontStyle} imageBackground={prefs.imageBackground} renderMath={prefs.renderMath} languages={articleLanguages} onChooseLanguage={(targetLang, targetTitle) => { update('lang', targetLang); void openArticle(targetTitle, true, targetLang); }} /> : <HomeScreen feed={feed} loading={prefs.feedEnabled && feed.length === 0} onOpen={title => void openArticle(title)} onRandom={randomArticle} enabled={prefs.feedEnabled} />)}
    {section === 'history' && <LibraryScreen title="Reading history" entries={filteredHistory} total={history.length} emptyTitle="No reading history" emptyText="Articles you read will appear here." filter={listFilter} setFilter={setListFilter} onOpen={entry => void openArticle(entry.title, true, entry.lang)} onClear={() => setHistory([])} onRemove={entry => setHistory(previous => previous.filter(item => !(item.title === entry.title && item.lang === entry.lang)))} clearLabel="Clear history" />}
    {section === 'saved' && <LibraryScreen title="Saved articles" entries={filteredSaved} total={saved.length} emptyTitle="No saved articles" emptyText="Save articles while reading to keep them here." filter={listFilter} setFilter={setListFilter} onOpen={entry => void openArticle(entry.title, true, entry.lang)} onClear={() => setSaved([])} onRemove={entry => setSaved(previous => previous.filter(item => !(item.title === entry.title && item.lang === entry.lang)))} clearLabel="Remove all" />}
    {section === 'settings' && <SettingsScreen prefs={prefs} update={update} languageFilter={languageFilter} setLanguageFilter={setLanguageFilter} onClearData={() => { setHistory([]); setSaved([]); setSearchHistory([]); writeStore(cacheKey, {}); }} />}
    {section === 'about' && <AboutScreen />}
    <m3e-divider />
    <m3e-list-item><m3e-icon variant="rounded" slot="leading" name="public" />Wikipedia · {selectedLangName}<span slot="supporting-text">WikiReader · Desktop</span></m3e-list-item>
    {prefs.searchHistory && searchHistory.length > 0 && <m3e-list>
      <m3e-list-item>Recent searches</m3e-list-item>
      {searchHistory.slice(0, 8).map(item => <m3e-list-item-button key={item} onClick={() => void openArticle(item)}><m3e-icon slot="leading" variant="rounded" name="history" />{item}</m3e-list-item-button>)}
      <m3e-list-item><m3e-button variant="text" onClick={() => setSearchHistory([])}>Clear search history</m3e-button></m3e-list-item>
    </m3e-list>}
  </>;

  return <m3e-theme color={prefs.colorScheme} scheme={prefs.theme} variant="tonal-spot" motion="expressive">
    <m3e-app-bar>
      <m3e-icon-button slot="leading" title="Home" onClick={() => { setSection('home'); setArticle(null); setArticleHtml(''); setStack([]); }}><m3e-icon variant="rounded" name="menu_book" filled /></m3e-icon-button>
      <span slot="headline">{titleBySection[section]}</span>
      <m3e-icon-button slot="trailing" title="Random article" onClick={randomArticle}><m3e-icon variant="rounded" name="shuffle" /></m3e-icon-button>
    </m3e-app-bar>
    <m3e-split-pane disabled orientation={portrait ? 'vertical' : 'horizontal'} value={portrait ? 92 : 8} min={portrait ? 88 : 6} max={portrait ? 96 : 20}>
      {!portrait && <m3e-nav-rail slot="start" mode="auto">{navigationItems}</m3e-nav-rail>}
      <m3e-content-pane slot={portrait ? 'start' : 'end'}>{screenContent}</m3e-content-pane>
      {portrait && <m3e-nav-bar slot="end" mode="compact">{navigationItems}</m3e-nav-bar>}
    </m3e-split-pane>
    {section === 'home' && <m3e-toolbar variant="vibrant" shape="rounded" elevated>
      <m3e-icon-button title="Search Wikipedia" aria-label="Search Wikipedia" variant="filled" onClick={() => document.querySelector<HTMLInputElement>('input[aria-label="Search Wikipedia"]')?.focus()}><m3e-icon variant="rounded" name="search" /></m3e-icon-button>
      <m3e-icon-button title="Article language" aria-label="Article language" disabled={!article || articleLanguages.length === 0} onClick={() => window.dispatchEvent(new CustomEvent('wikireader:show-languages'))}><m3e-icon variant="rounded" name="translate" /></m3e-icon-button>
      <m3e-icon-button title="Share article" aria-label="Share article" disabled={!article} onClick={() => void shareArticle()}><m3e-icon variant="rounded" name="share" /></m3e-icon-button>
      <m3e-icon-button title={isSaved ? 'Remove saved article' : 'Save article'} aria-label={isSaved ? 'Remove saved article' : 'Save article'} selected={isSaved} disabled={!article} onClick={toggleSaved}><m3e-icon variant="rounded" name="bookmark" filled={isSaved} /></m3e-icon-button>
      <m3e-icon-button title="Scroll to top" aria-label="Scroll to top" onClick={() => document.querySelector<HTMLElement>('m3e-content-pane')?.scrollTo({ top: 0, behavior: 'smooth' })}><m3e-icon variant="rounded" name="arrow_upward" /></m3e-icon-button>
      <m3e-icon-button title="Random article" aria-label="Random article" onClick={() => void randomArticle()}><m3e-icon variant="rounded" name="shuffle" /></m3e-icon-button>
    </m3e-toolbar>}
  </m3e-theme>;
}

function HomeScreen({ feed, loading, onOpen, onRandom, enabled }: { feed: Page[]; loading: boolean; onOpen: (title: string) => void; onRandom: () => void; enabled: boolean }) {
  const lead = feed[0];
  return <m3e-list>
    <m3e-list-item><m3e-icon variant="rounded" slot="leading" name="star" filled />Discover Wikipedia<span slot="supporting-text">Explore featured articles and the world’s knowledge.</span><m3e-button slot="trailing" variant="filled" onClick={onRandom}>Random article</m3e-button></m3e-list-item>
    {!enabled && <m3e-list-item>Article feed is disabled in Settings.</m3e-list-item>}
    {loading && <m3e-list-item><m3e-progress-indicator indeterminate />Loading featured articles…</m3e-list-item>}
    {lead && <m3e-card variant="outlined" onClick={() => onOpen(lead.title)}>
      {lead.thumbnail?.source && <img src={lead.thumbnail.source} alt="" />}
      <m3e-list-item><m3e-icon variant="rounded" slot="leading" name="star" filled />Featured article<span slot="supporting-text">{lead.title} · {lead.description || lead.extract || 'Read the featured article.'}</span><m3e-button slot="trailing" variant="tonal" onClick={event => { event.stopPropagation(); onOpen(lead.title); }}>Read</m3e-button></m3e-list-item>
    </m3e-card>}
    {feed.slice(1).map((item, index) => <m3e-list-item-button key={item.pageid ?? item.title} onClick={() => onOpen(item.title)}>
      {item.thumbnail?.source && <img slot="leading" src={item.thumbnail.source} alt="" />}
      <span>{item.title}</span><span slot="supporting-text">{item.description || item.extract || 'Explore this Wikipedia article.'}</span><m3e-icon variant="rounded" slot="trailing" name="chevron_right" />
    </m3e-list-item-button>)}
    {!loading && enabled && feed.length === 0 && <m3e-list-item>Featured articles are unavailable. Try a random article or search.</m3e-list-item>}
  </m3e-list>;
}

function ArticleScreen({ article, html, loading, saved, onBack, onSave, showContents, setShowContents, fontSize, dataSaver, expandedSections, fontStyle, imageBackground, renderMath, languages, onChooseLanguage }: { article: Page; html: string; loading: boolean; saved: boolean; onBack: () => void; onSave: () => void; showContents: boolean; setShowContents: (value: boolean) => void; fontSize: number; dataSaver: boolean; expandedSections: boolean; fontStyle: string; imageBackground: boolean; renderMath: boolean; languages: ArticleLanguage[]; onChooseLanguage: (lang: string, title: string) => void }) {
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
  return <m3e-list>
    <m3e-list-item>
      <m3e-button variant="text" onClick={onBack}><m3e-icon variant="rounded" slot="leading" name="arrow_back" />Back</m3e-button>
      <m3e-icon-button slot="trailing" title="Article contents" onClick={() => setShowContents(!showContents)}><m3e-icon variant="rounded" name="format_list_bulleted" /></m3e-icon-button>
      <m3e-icon-button slot="trailing" title={saved ? 'Remove saved article' : 'Save article'} onClick={onSave}><m3e-icon variant="rounded" name="bookmark" filled={saved} /></m3e-icon-button>
      <m3e-button slot="trailing" variant="text" onClick={() => setShowLanguages(value => !value)}><m3e-icon variant="rounded" slot="leading" name="language" />Languages</m3e-button>
      <m3e-button slot="trailing" variant="text" href={'https://' + (article.lang || 'en') + '.wikipedia.org/wiki/' + titleToPath(article.title)} target="_blank">Wikipedia</m3e-button>
    </m3e-list-item>
    {showLanguages && <m3e-card variant="outlined"><m3e-list-item><span>Available article languages</span><span slot="supporting-text">Choose a translation of this article.</span></m3e-list-item><m3e-list-item><m3e-search-bar clearable><m3e-icon variant="rounded" slot="leading" name="search" /><input slot="input" aria-label="Search article languages" placeholder="Find language or title" value={languageQuery} onChange={event => setLanguageQuery(event.target.value)} /></m3e-search-bar></m3e-list-item>{languages.filter(item => (item.name + ' ' + item.lang + ' ' + item.title).toLowerCase().includes(languageQuery.toLowerCase())).map(item => <m3e-list-item-button key={item.lang} selected={item.lang === article.lang} onClick={() => { setShowLanguages(false); setLanguageQuery(''); onChooseLanguage(item.lang, item.title); }}><m3e-icon variant="rounded" slot="leading" name={item.lang === article.lang ? 'check_circle' : 'language'} />{item.name || item.lang}<span slot="supporting-text">{item.title} · {item.lang}</span></m3e-list-item-button>)}{languages.length === 0 && <m3e-list-item>No translations were found for this article.</m3e-list-item>}</m3e-card>}
    {showContents && <m3e-card variant="outlined"><m3e-list-item>On this page</m3e-list-item>{headings.length ? headings.map(item => <m3e-list-item-button key={item.id} onClick={() => { document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setShowContents(false); }}>{item.text}</m3e-list-item-button>) : <m3e-list-item>Contents will appear when the article loads.</m3e-list-item>}</m3e-card>}
    <m3e-list-item><span slot="overline">Wikipedia article</span><span>{article.title}</span>{article.description && <span slot="supporting-text">{article.description}</span>}</m3e-list-item>
    {article.thumbnail?.source && !dataSaver && <m3e-card variant="outlined"><img src={article.thumbnail.source} alt={article.title} /><m3e-list-item>{article.title}</m3e-list-item></m3e-card>}
    {article.extract && <m3e-list-item>{article.extract}</m3e-list-item>}
    {loading && <m3e-list-item><m3e-progress-indicator indeterminate />Loading full article…</m3e-list-item>}
    {html && <ArticleRenderer html={html} lang={article.lang || 'en'} dataSaver={dataSaver} expandedSections={expandedSections} fontSize={fontSize} fontStyle={fontStyle} imageBackground={imageBackground} renderMath={renderMath} onLinkClick={title => { const target = title.trim(); if (target) window.dispatchEvent(new CustomEvent('wikireader:open-article', { detail: { title: target, lang: article.lang || 'en' } })); }} />}
    {!loading && !html && <m3e-list-item>The full article could not be loaded. A cached copy may be available when you reconnect.</m3e-list-item>}
    <m3e-list-item><m3e-icon variant="rounded" slot="leading" name="check_circle" />End of article<m3e-button slot="trailing" variant="text" onClick={onBack}>Keep exploring</m3e-button></m3e-list-item>
  </m3e-list>;
}

function LibraryScreen({ title, entries, total, emptyTitle, emptyText, filter, setFilter, onOpen, onClear, onRemove, clearLabel }: { title: string; entries: Entry[]; total: number; emptyTitle: string; emptyText: string; filter: string; setFilter: (value: string) => void; onOpen: (entry: Entry) => void; onClear: () => void; onRemove: (entry: Entry) => void; clearLabel: string }) {
  return <m3e-list>
    <m3e-list-item><span slot="overline">Your library</span><span>{title}</span><span slot="supporting-text">{total} {total === 1 ? 'article' : 'articles'}</span>{total > 0 && <m3e-button slot="trailing" variant="text" onClick={onClear}>{clearLabel}</m3e-button>}</m3e-list-item>
    {total > 0 && <m3e-list-item><m3e-search-bar clearable><m3e-icon variant="rounded" slot="leading" name="search" /><input slot="input" aria-label="Filter articles" placeholder="Filter articles" value={filter} onChange={event => setFilter(event.target.value)} /></m3e-search-bar></m3e-list-item>}
    {entries.length === 0 && <m3e-list-item><m3e-icon variant="rounded" slot="leading" name="library_books" /><span>{total ? 'No matching articles' : emptyTitle}</span><span slot="supporting-text">{total ? 'Try a different search term.' : emptyText}</span></m3e-list-item>}
    {entries.map(entry => <m3e-list-item key={entry.lang + ':' + entry.title}>
      {entry.thumbnail && <img slot="leading" src={entry.thumbnail} alt="" />}
      <span>{entry.title}</span><span slot="supporting-text">{entry.description || entry.lang.toUpperCase() + ' Wikipedia'} · {new Date(entry.visited).toLocaleDateString()}</span>
      <m3e-button slot="trailing" variant="text" onClick={() => onOpen(entry)}>Open</m3e-button>
      <m3e-icon-button slot="trailing" title="Remove article" onClick={() => onRemove(entry)}><m3e-icon variant="rounded" name="close" /></m3e-icon-button>
    </m3e-list-item>)}
  </m3e-list>;
}

function SettingsScreen({ prefs, update, languageFilter, setLanguageFilter, onClearData }: { prefs: Preferences; update: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void; languageFilter: string; setLanguageFilter: (value: string) => void; onClearData: () => void }) {
  const [confirmClear, setConfirmClear] = useState(false);
  const themes = [['auto','System default'],['light','Light'],['dark','Dark']] as const;
  const cycle = (key: 'theme' | 'fontStyle') => {
    if (key === 'theme') { const values = themes.map(item => item[0]); update('theme', values[(values.indexOf(prefs.theme) + 1) % values.length]); }
    else update('fontStyle', prefs.fontStyle === 'sans' ? 'serif' : 'sans');
  };
  const booleanItems: { key: keyof Preferences; label: string; description: string }[] = [
    { key: 'blackTheme', label: 'Black theme', description: 'Use a black background in dark appearance.' },
    { key: 'dataSaver', label: 'Data saver', description: 'Avoid loading article and feed images.' },
    { key: 'feedEnabled', label: 'Home feed', description: 'Show featured and most-read articles.' },
    { key: 'expandedSections', label: 'Expand article sections', description: 'Keep article sections expanded while reading.' },
    { key: 'imageBackground', label: 'Image background', description: 'Show a surface behind article images.' },
    { key: 'immersiveMode', label: 'Immersive mode', description: 'Reduce app chrome while reading.' },
    { key: 'renderMath', label: 'Render mathematical notation', description: 'Display equations in article content.' },
    { key: 'browsingHistory', label: 'Browsing history', description: 'Remember articles you have opened.' },
    { key: 'searchHistory', label: 'Search history', description: 'Keep recent search terms.' }
  ];
  return <m3e-list>
    <m3e-list-item><span slot="overline">Personalization</span><span>Settings</span><span slot="supporting-text">Preferences based on the original Android app.</span></m3e-list-item>
    <m3e-list-item><m3e-icon variant="rounded" slot="leading" name="brightness_6" /><span>Theme</span><span slot="supporting-text">{themes.find(item => item[0] === prefs.theme)?.[1] || 'System default'}</span><m3e-button slot="trailing" variant="outlined" onClick={() => cycle('theme')}>Change</m3e-button></m3e-list-item>
    <m3e-list-item><m3e-icon variant="rounded" slot="leading" name="palette" /><span>Color scheme</span><span slot="supporting-text">Choose a color accent for M3E components.</span></m3e-list-item>
    <m3e-list>
      {['#6750a4','#006a6a','#8c4a60','#415f91','#795900','#006e1c','#b3261e'].map(color => <m3e-list-item-button key={color} selected={prefs.colorScheme === color} onClick={() => update('colorScheme', color)}><m3e-icon variant="rounded" slot="leading" name={prefs.colorScheme === color ? 'radio_button_checked' : 'radio_button_unchecked'} />{color}</m3e-list-item-button>)}
    </m3e-list>
    <m3e-list-item><m3e-icon variant="rounded" slot="leading" name="language" /><span>Wikipedia language</span><span slot="supporting-text">Current language: {languages.find(item => item[0] === prefs.lang)?.[1] || prefs.lang}</span></m3e-list-item>
    <m3e-list-item><m3e-search-bar clearable><m3e-icon variant="rounded" slot="leading" name="search" /><input slot="input" aria-label="Find Wikipedia language" placeholder="Find language" value={languageFilter} onChange={event => setLanguageFilter(event.target.value)} /></m3e-search-bar></m3e-list-item>
    <m3e-list>{languages.filter(item => (item[0] + ' ' + item[1]).toLowerCase().includes(languageFilter.toLowerCase())).map(item => <m3e-list-item-button key={item[0]} selected={prefs.lang === item[0]} onClick={() => { update('lang', item[0]); setLanguageFilter(''); }}><m3e-icon variant="rounded" slot="leading" name={prefs.lang === item[0] ? 'radio_button_checked' : 'radio_button_unchecked'} /><span>{item[1]}</span><span slot="supporting-text">{item[0]}</span></m3e-list-item-button>)}</m3e-list>
    <m3e-list-item><m3e-icon variant="rounded" slot="leading" name="text_fields" /><span>Font style</span><span slot="supporting-text">{prefs.fontStyle === 'serif' ? 'Serif' : 'Sans serif'}</span><m3e-button slot="trailing" variant="outlined" onClick={() => cycle('fontStyle')}>Change</m3e-button></m3e-list-item>
    <m3e-list-item><m3e-icon variant="rounded" slot="leading" name="format_size" /><span>Article font size</span><span slot="supporting-text">{prefs.fontSize} sp</span><m3e-button slot="trailing" variant="text" disabled={prefs.fontSize <= 12} onClick={() => update('fontSize', Math.max(12, prefs.fontSize - 1))}>−</m3e-button><m3e-button slot="trailing" variant="text" disabled={prefs.fontSize >= 32} onClick={() => update('fontSize', Math.min(32, prefs.fontSize + 1))}>+</m3e-button></m3e-list-item>
    {booleanItems.map(item => <m3e-list-item key={item.key}><m3e-icon variant="rounded" slot="leading" name="tune" /><span>{item.label}</span><span slot="supporting-text">{item.description}</span><m3e-switch slot="trailing" checked={Boolean(prefs[item.key])} onClick={() => update(item.key, !prefs[item.key] as Preferences[typeof item.key])} /></m3e-list-item>)}
    <m3e-list-item><span>Local data</span><span slot="supporting-text">Clear saved articles, history, searches, and cached article pages from this device.</span><m3e-button slot="trailing" variant="outlined" onClick={() => setConfirmClear(true)}>Clear data</m3e-button></m3e-list-item>
    {confirmClear && <m3e-card variant="outlined"><m3e-list-item>Clear all local data?<span slot="supporting-text">This cannot be undone.</span><m3e-button slot="trailing" variant="text" onClick={() => setConfirmClear(false)}>Cancel</m3e-button><m3e-button slot="trailing" variant="filled" onClick={() => { onClearData(); setConfirmClear(false); }}>Clear</m3e-button></m3e-list-item></m3e-card>}
    <m3e-list-item><m3e-button variant="text" onClick={() => { Object.keys(localStorage).filter(key => key.startsWith('wr-')).forEach(key => localStorage.removeItem(key)); window.location.reload(); }}>Reset settings</m3e-button></m3e-list-item>
  </m3e-list>;
}

function AboutScreen() {
  return <m3e-list>
    <m3e-list-item><m3e-icon variant="rounded" slot="leading" name="menu_book" filled /><span>WikiReader</span><span slot="supporting-text">A simple reader for Wikipedia.</span></m3e-list-item>
    <m3e-list-item><m3e-icon variant="rounded" slot="leading" name="info" /><span>Version</span><span slot="supporting-text">2.5.5 desktop</span></m3e-list-item>
    <m3e-list-item><m3e-icon variant="rounded" slot="leading" name="code" /><span>Source code</span><span slot="supporting-text">GitHub</span><m3e-button slot="trailing" variant="text" href="https://github.com/nsh07/WikiReader" target="_blank">Open</m3e-button></m3e-list-item>
    <m3e-list-item><m3e-icon variant="rounded" slot="leading" name="gavel" /><span>License</span><span slot="supporting-text">GPL v3.0</span><m3e-button slot="trailing" variant="text" href="https://github.com/nsh07/WikiReader/blob/main/LICENSE" target="_blank">Open</m3e-button></m3e-list-item>
    <m3e-list-item><m3e-icon variant="rounded" slot="leading" name="translate" /><span>Translate WikiReader</span><span slot="supporting-text">Help translate the app.</span><m3e-button slot="trailing" variant="text" href="https://hosted.weblate.org/engage/wikireader/" target="_blank">Open</m3e-button></m3e-list-item>
    <m3e-list-item><m3e-icon variant="rounded" slot="leading" name="public" /><span>Wikipedia</span><span slot="supporting-text">Article content and media are supplied by Wikipedia and Wikimedia projects.</span><m3e-button slot="trailing" variant="text" href="https://wikipedia.org" target="_blank">Open</m3e-button></m3e-list-item>
  </m3e-list>;
}
