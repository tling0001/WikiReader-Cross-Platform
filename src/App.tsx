import React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HTMLAttributes } from 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'm3e-circular-progress-indicator': HTMLAttributes<HTMLElement> & { indeterminate?: boolean; value?: number; max?: number; variant?: string };
      'm3e-linear-progress-indicator': HTMLAttributes<HTMLElement> & { mode?: 'determinate' | 'indeterminate' | 'query'; value?: number; max?: number; variant?: string };
    }
  }
}
import ArticleRenderer from './ArticleRenderer';

type Page = { title: string; description?: string; extract?: string; thumbnail?: { source: string; width?: number; height?: number }; pageid?: number; lang?: string; views?: number; viewHistory?: { views?: number }[] };
type FeedImage = { title?: string; thumbnail?: { source: string; width?: number; height?: number }; image?: { source: string; width?: number; height?: number }; description?: { text?: string }; artist?: { name?: string; text?: string }; credit?: { text?: string }; file_page?: string };
type FeedNews = { story?: string; links?: Page[] };
type FeedOnThisDay = { text?: string; year?: number; pages?: Page[] };
type Entry = { title: string; lang: string; visited: number; description?: string; thumbnail?: string };
type ArticleLanguage = { lang: string; title: string; name?: string };
type Section = 'home' | 'history' | 'saved' | 'settings' | 'about';
type Preferences = { theme: 'auto' | 'light' | 'dark'; lang: string; fontStyle: string; colorScheme: string; fontSize: number; blackTheme: boolean; dataSaver: boolean; feedEnabled: boolean; expandedSections: boolean; imageBackground: boolean; immersiveMode: boolean; renderMath: boolean; browsingHistory: boolean; searchHistory: boolean };
const defaults: Preferences = { theme: 'auto', lang: 'en', fontStyle: 'sans', colorScheme: '#ffffff', fontSize: 16, blackTheme: false, dataSaver: false, feedEnabled: true, expandedSections: false, imageBackground: false, immersiveMode: true, renderMath: true, browsingHistory: true, searchHistory: true };
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
  const [feed, setFeed] = useState<{ featured: Page | null; trending: Page[]; image: FeedImage | null; news: FeedNews[]; onthisday: FeedOnThisDay[] }>({ featured: null, trending: [], image: null, news: [], onthisday: [] });
  const [feedLoading, setFeedLoading] = useState(true);
  const [article, setArticle] = useState<Page | null>(null);
  const [articleHtml, setArticleHtml] = useState('');
  const [articleLanguages, setArticleLanguages] = useState<ArticleLanguage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [stack, setStack] = useState<string[]>([]);
  const [showContents, setShowContents] = useState(false);
  const [languageFilter, setLanguageFilter] = useState('');
  const [listFilter, setListFilter] = useState('');
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 600px)').matches);
  const [showNavigation, setShowNavigation] = useState(false);
  const [railExpanded, setRailExpanded] = useState(false);
  const [showGlobalLanguagePicker, setShowGlobalLanguagePicker] = useState(false);
  const [globalLanguageFilter, setGlobalLanguageFilter] = useState('');
  const lang = prefs.lang;
  const update = <K extends keyof Preferences,>(key: K, value: Preferences[K]) => setPrefs(previous => ({ ...previous, [key]: value }));

  useEffect(() => {
    const query = window.matchMedia('(min-width: 600px)');
    const updateWidth = () => setWide(query.matches);
    updateWidth();
    query.addEventListener('change', updateWidth);
    return () => query.removeEventListener('change', updateWidth);
  }, []);

  useEffect(() => { writeStore('wr-preferences', prefs); }, [prefs]);
  useEffect(() => { writeStore('wr-history', history); }, [history]);
  useEffect(() => { writeStore('wr-saved', saved); }, [saved]);
  useEffect(() => { writeStore('wr-search-history', searchHistory); }, [searchHistory]);

  useEffect(() => {
    let active = true;
    if (!prefs.feedEnabled) { setFeed({ featured: null, trending: [], image: null, news: [], onthisday: [] }); setFeedLoading(false); return () => { active = false; }; }
    setFeedLoading(true);
    const date = new Date().toISOString().slice(0, 10).replaceAll('-', '/');
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
          title: item.titles?.canonical || item.titles?.normalized || item.title || '',
          thumbnail: item.thumbnail ?? item.originalimage, description: item.description, extract: item.extract, pageid: item.pageid, views: item.views, viewHistory: item.viewHistory
        });
        setFeed({
          featured: data.tfa ? normalize(data.tfa) : null,
          trending: (data.mostread?.articles ?? []).map(normalize).filter(item => item.title).slice(0, 15),
          image: data.image ?? null,
          news: (data.news ?? []).map(item => ({ story: item.story, links: (item.links ?? []).map(normalize).filter(link => link.title) })),
          onthisday: (data.onthisday ?? []).map(item => ({ text: item.text, year: item.year, pages: (item.pages ?? []).map(normalize).filter(page => page.title) }))
        });
        setFeedLoading(false);
      })
      .catch(() => { if (active) { setFeed({ featured: null, trending: [], image: null, news: [], onthisday: [] }); setFeedLoading(false); } });
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
    setError(''); setLoading(true); setSection('home'); setQuery(''); setSuggestions([]); setShowContents(false); setArticleLanguages([]); document.querySelector('m3e-search-view')?.removeAttribute('open');
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
  const filteredHistory = history.filter(item => (item.title + ' ' + (item.description || '')).toLowerCase().includes(listFilter.toLowerCase()));
  const filteredSaved = saved.filter(item => (item.title + ' ' + (item.description || '')).toLowerCase().includes(listFilter.toLowerCase()));
  const selectedLangName = languages.find(item => item[0] === lang)?.[1] ?? lang;

  const goToSection = (target: Section) => {
    setSection(target); setShowNavigation(false); setListFilter('');
    if (target === 'home' && !article) { setArticleHtml(''); setArticleLanguages([]); setStack([]); setShowContents(false); setQuery(''); setSuggestions([]); }
  };
  const returnFromSettings = () => { setSection('home'); setShowNavigation(false); setListFilter(''); };
  const navigationItems = <>
    <m3e-nav-item selected={section === 'home' && !article} onClick={() => { if (!article) goToSection('home'); }}><m3e-icon slot="icon" variant="rounded" name="home" />Home</m3e-nav-item>
    <m3e-nav-item selected={section === 'saved'} onClick={() => goToSection('saved')}><m3e-icon slot="icon" variant="rounded" name="bookmark" />Saved</m3e-nav-item>
    {prefs.browsingHistory && <m3e-nav-item selected={section === 'history'} onClick={() => goToSection('history')}><m3e-icon slot="icon" variant="rounded" name="history" />History</m3e-nav-item>}
    <m3e-nav-item selected={section === 'settings'} onClick={() => goToSection('settings')}><m3e-icon slot="icon" variant="rounded" name="settings" />Settings</m3e-nav-item>
    <m3e-nav-item selected={section === 'about'} onClick={() => goToSection('about')}><m3e-icon slot="icon" variant="rounded" name="info" />About</m3e-nav-item>
  </>;
  const searchActive = query.trim().length > 1;
  const screenContent = <>
    {error && <m3e-card variant="outlined"><m3e-list-item><m3e-icon variant="rounded" slot="leading" name="error" />{error}<m3e-button slot="trailing" variant="text" onClick={() => setError('')}>Dismiss</m3e-button></m3e-list-item></m3e-card>}
    {section === 'home' && (searchActive ? null : article ? <ArticleScreen article={article} html={articleHtml} loading={loading} saved={isSaved} onBack={back} onSave={toggleSaved} showContents={showContents} setShowContents={setShowContents} fontSize={prefs.fontSize} dataSaver={prefs.dataSaver} expandedSections={prefs.expandedSections} fontStyle={prefs.fontStyle} imageBackground={prefs.imageBackground} renderMath={prefs.renderMath} languages={articleLanguages} onChooseLanguage={(targetLang, targetTitle) => { update('lang', targetLang); void openArticle(targetTitle, true, targetLang); }} /> : <HomeScreen feed={feed} loading={feedLoading} onOpen={title => void openArticle(title)} onRandom={randomArticle} enabled={prefs.feedEnabled} />)}
    {section === 'history' && <LibraryScreen title="Reading history" entries={filteredHistory} total={history.length} emptyTitle="No reading history" emptyText="Articles you read will appear here." filter={listFilter} setFilter={setListFilter} onOpen={entry => void openArticle(entry.title, true, entry.lang)} onClear={() => setHistory([])} onRemove={entry => setHistory(previous => previous.filter(item => !(item.title === entry.title && item.lang === entry.lang)))} clearLabel="Clear history" />}
    {section === 'saved' && <LibraryScreen title="Saved articles" entries={filteredSaved} total={saved.length} emptyTitle="No saved articles" emptyText="Articles you save will appear here." filter={listFilter} setFilter={setListFilter} onOpen={entry => void openArticle(entry.title, true, entry.lang)} onClear={() => setSaved([])} onRemove={entry => setSaved(previous => previous.filter(item => !(item.title === entry.title && item.lang === entry.lang)))} clearLabel="Remove all" />}
    {section === 'settings' && <SettingsScreen prefs={prefs} update={update} languageFilter={languageFilter} setLanguageFilter={setLanguageFilter} onClearData={() => { setHistory([]); setSaved([]); setSearchHistory([]); writeStore(cacheKey, {}); }} onReset={() => { setPrefs({ ...defaults }); setLanguageFilter(''); }} />}
    {section === 'about' && <AboutScreen />}
    {section === 'home' && !article && !searchActive && prefs.searchHistory && searchHistory.length > 0 && <m3e-list><m3e-list-item><span slot="overline">Search history</span><span>Recent searches</span><m3e-button slot="trailing" variant="text" onClick={() => setSearchHistory([])}>Clear</m3e-button></m3e-list-item>{searchHistory.slice(0,8).map(item => <m3e-list-item-button key={item} onClick={() => setQuery(item)}><m3e-icon slot="leading" variant="rounded" name="history" />{item}</m3e-list-item-button>)}</m3e-list>}
  </>;
  const titleBySection: Record<Section, string> = { home: article?.title ?? 'WikiReader', history: 'History', saved: 'Saved articles', settings: 'Settings', about: 'About WikiReader' };
  return <m3e-theme className="app-shell" color={prefs.colorScheme.toLowerCase() === '#ffffff' ? '#6650a4' : prefs.colorScheme} scheme={prefs.blackTheme && prefs.theme === 'dark' ? 'dark' : prefs.theme} variant="tonal-spot" motion="expressive">
    <m3e-drawer-container start={showNavigation && !wide} start-mode="over" onChange={event => setShowNavigation(Boolean((event.currentTarget as HTMLElement & { start?: boolean }).start))} style={{ backgroundColor: 'var(--md-sys-color-surface)' }}>
      <nav slot="start" aria-label="Main navigation" style={{ backgroundColor: 'var(--md-sys-color-surface)', color: 'var(--md-sys-color-on-surface)' }}>
        <m3e-nav-rail mode="expanded">{navigationItems}</m3e-nav-rail>
      </nav>
    <m3e-split-pane className="app-layout" disabled orientation="horizontal" value={wide ? 13 : 0} min={wide ? 13 : 0} max={wide ? 13 : 0} style={{ backgroundColor: 'var(--md-sys-color-surface)', color: 'var(--md-sys-color-on-surface)' }}>
      {wide && <m3e-nav-rail slot="start" mode={railExpanded ? "expanded" : "compact"} style={{ backgroundColor: 'var(--md-sys-color-surface)', color: 'var(--md-sys-color-on-surface)' }}>
        <m3e-icon-button title="Toggle navigation rail" aria-label="Toggle navigation rail" onClick={() => setRailExpanded(value => !value)}><m3e-icon variant="rounded" name={railExpanded ? "menu_open" : "menu"} /></m3e-icon-button>
        {navigationItems}
      </m3e-nav-rail>}
      <div className="app-main" slot="end">
        <m3e-app-bar centered>
          {section !== 'home'
            ? <m3e-icon-button slot="leading-icon" title="Back" aria-label="Back" onClick={() => section === 'settings' ? returnFromSettings() : goToSection('home')}><m3e-icon variant="rounded" name="arrow_back" /></m3e-icon-button>
            : wide
              ? <m3e-icon-button slot="leading-icon" title="Search Wikipedia" aria-label="Search Wikipedia" onClick={() => { const view = document.querySelector('m3e-search-view'); view?.setAttribute('open', ''); document.querySelector<HTMLInputElement>('input[aria-label="Search Wikipedia"]')?.focus(); }}><m3e-icon variant="rounded" name="search" /></m3e-icon-button>
              : <m3e-icon-button slot="leading-icon" title="Open navigation" onClick={() => setShowNavigation(true)}><m3e-icon variant="rounded" name="menu" /></m3e-icon-button>}
          {section === 'home' ? <m3e-search-view mode="fullscreen" clear-label="Clear search" close-label="Close search">
            <input slot="input" aria-label="Search Wikipedia" placeholder={'Search ' + selectedLangName + ' Wikipedia'} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') doSearch(); }} />
            {searchActive && <m3e-list>
              <m3e-list-item><span slot="overline">Wikipedia search</span><span>Results for “{query.trim()}”</span><m3e-button slot="trailing" variant="filled" onClick={doSearch}>Open article</m3e-button></m3e-list-item>
              {searching && <m3e-list-item><m3e-circular-progress-indicator indeterminate />Searching Wikipedia…</m3e-list-item>}
              {suggestions.map(item => <m3e-list-item-button key={item.pageid ?? item.title} onClick={() => void openArticle(item.title)}>{item.thumbnail?.source && <img slot="leading" src={item.thumbnail.source} alt="" />}<span>{item.title}</span><span slot="supporting-text">{item.description || 'Wikipedia article'}</span><m3e-icon variant="rounded" slot="trailing" name="chevron_right" /></m3e-list-item-button>)}
              {!searching && suggestions.length === 0 && <m3e-list-item>No matches found. You can still open “{query.trim()}”.</m3e-list-item>}
            </m3e-list>}
          </m3e-search-view> : <span slot="title">{titleBySection[section]}</span>}
          {section === 'settings' ? <m3e-icon-button slot="trailing" title="Reset settings" onClick={() => window.dispatchEvent(new Event('wikireader:reset-settings'))}><m3e-icon variant="rounded" name="refresh" /></m3e-icon-button> : section === 'home' ? <m3e-icon-button slot="trailing" title="Random article" onClick={() => void randomArticle()}><m3e-icon variant="rounded" name="shuffle" /></m3e-icon-button> : null}
        </m3e-app-bar>
        {loading && <m3e-linear-progress-indicator mode="indeterminate" />}
        <m3e-content-pane className="app-content" style={{ backgroundColor: 'var(--md-sys-color-surface)', color: 'var(--md-sys-color-on-surface)' }}>{screenContent}</m3e-content-pane>
      </div>
    </m3e-split-pane>
</m3e-drawer-container>
    {showGlobalLanguagePicker && <LanguagePickerDialog open={showGlobalLanguagePicker} filter={globalLanguageFilter} setFilter={setGlobalLanguageFilter} currentLang={prefs.lang} title="Wikipedia language" onClose={() => setShowGlobalLanguagePicker(false)} onChoose={targetLang => { update('lang', targetLang); setShowGlobalLanguagePicker(false); setGlobalLanguageFilter(''); }} />}
    {section === 'home' && <div className="reading-actions"><m3e-toolbar className="reading-toolbar" variant="vibrant" shape="rounded" elevated>
      {article && <m3e-icon-button title="Back" aria-label="Back" onClick={back}><m3e-icon variant="rounded" name="arrow_back" /></m3e-icon-button>}
      <m3e-icon-button title="Article language" aria-label="Article language" disabled={Boolean(article && articleLanguages.length === 0)} onClick={() => article ? window.dispatchEvent(new CustomEvent('wikireader:show-languages')) : setShowGlobalLanguagePicker(true)}><m3e-icon variant="rounded" name="translate" /></m3e-icon-button>
      <m3e-icon-button title="Share article" aria-label="Share article" disabled={!article} onClick={() => void shareArticle()}><m3e-icon variant="rounded" name="share" /></m3e-icon-button>
      <m3e-icon-button title={isSaved ? 'Remove saved article' : 'Save article'} aria-label={isSaved ? 'Remove saved article' : 'Save article'} selected={isSaved} disabled={!article} onClick={toggleSaved}><m3e-icon variant="rounded" name="bookmark" filled={isSaved} /></m3e-icon-button>
      <m3e-icon-button title="Scroll to top" aria-label="Scroll to top" onClick={() => { const pane = document.querySelector<HTMLElement>('m3e-content-pane'); const scroller = pane?.shadowRoot?.querySelector<HTMLElement>('.scroll-container') || pane; scroller?.scrollTo({ top: 0, behavior: 'smooth' }); }}><m3e-icon variant="rounded" name="arrow_upward" /></m3e-icon-button>
      <m3e-icon-button title="Random article" aria-label="Random article" onClick={() => void randomArticle()}><m3e-icon variant="rounded" name="shuffle" /></m3e-icon-button>
    </m3e-toolbar><m3e-fab className="reading-search-fab" variant="primary-container" size="medium" aria-label="Search Wikipedia" title="Search Wikipedia" onClick={() => { const view = document.querySelector('m3e-search-view'); view?.setAttribute('open', ''); document.querySelector<HTMLInputElement>('input[aria-label="Search Wikipedia"]')?.focus(); }}><m3e-icon variant="rounded" name="search" /></m3e-fab></div>}
  </m3e-theme>;
}
 
function HomeScreen({ feed, loading, onOpen, onRandom, enabled }: { feed: { featured: Page | null; trending: Page[]; image: FeedImage | null; news: FeedNews[]; onthisday: FeedOnThisDay[] }; loading: boolean; onOpen: (title: string) => void; onRandom: () => void; enabled: boolean }) {
  const [trendingPage, setTrendingPage] = useState(0);
  useEffect(() => setTrendingPage(0), [feed.trending.length, feed.featured?.title]);
  const pages = Math.max(1, Math.ceil(feed.trending.length / 5));
  const visible = feed.trending.slice(trendingPage * 5, trendingPage * 5 + 5);
  const today = new Date().toLocaleDateString(undefined, { dateStyle: 'long' });
  return <div>
    {!enabled && <m3e-card variant="outlined"><m3e-list-item>Article feed is disabled in Settings.</m3e-list-item></m3e-card>}
    {loading && enabled && <m3e-list-item><m3e-circular-progress-indicator indeterminate />Loading today's articles…</m3e-list-item>}
    {enabled && feed.featured && <>
      <m3e-heading level="2" variant="headline" size="medium">Featured article</m3e-heading>
      <m3e-heading level="6" variant="label" size="medium">{today}</m3e-heading>
      <m3e-card variant="filled" actionable onClick={() => onOpen(feed.featured?.title || '')}>
        {feed.featured.thumbnail?.source && <img src={feed.featured.thumbnail.source} alt={feed.featured.title} width={feed.featured.thumbnail.width} height={feed.featured.thumbnail.height} loading="lazy" />}
        <m3e-heading level="3" variant="headline" size="medium" style={{ fontFamily: 'serif' }}>{feed.featured.title}</m3e-heading>
        {feed.featured.description && <m3e-list-item><span slot="supporting-text">{feed.featured.description}</span></m3e-list-item>}
        {feed.featured.extract && <m3e-list-item>{feed.featured.extract.length > 520 ? feed.featured.extract.slice(0, 517).trimEnd() + '…' : feed.featured.extract}</m3e-list-item>}
      </m3e-card>
    </>}
    {enabled && feed.trending.length > 0 && <>
      <m3e-heading level="3" variant="title" size="large">Trending articles</m3e-heading>
      <m3e-heading level="6" variant="label" size="medium">Top articles of the day</m3e-heading>
      <m3e-list>
        {visible.map((item, index) => <m3e-list-item-button key={item.pageid ?? item.title} onClick={() => onOpen(item.title)}>
          {item.thumbnail?.source && <img slot="leading" src={item.thumbnail.source} alt="" width="80" height="80" loading="lazy" />}
          <span slot="overline">{trendingPage * 5 + index + 1}</span>
          <span>{item.title}</span>
          <span slot="supporting-text">{item.description || item.extract || ''}{item.views ? ' · ' + new Intl.NumberFormat(undefined,{notation:'compact'}).format(item.views) + ' views today' : ''}</span>
          <m3e-icon variant="rounded" slot="trailing" name="chevron_right" />
        </m3e-list-item-button>)}
      </m3e-list>
      {pages > 1 && <m3e-list><m3e-list-item><span slot="supporting-text">Page {trendingPage+1} of {pages}</span><m3e-button-group slot="trailing" variant="connected"><m3e-button variant="tonal" shape="square" disabled={trendingPage===0} onClick={()=>setTrendingPage(v=>Math.max(0,v-1))}>Previous</m3e-button><m3e-button variant="tonal" shape="square" disabled={trendingPage===pages-1} onClick={()=>setTrendingPage(v=>Math.min(pages-1,v+1))}>Next</m3e-button></m3e-button-group></m3e-list-item></m3e-list>}
    </>}
    {enabled && (feed.image?.thumbnail?.source || feed.image?.image?.source) && <>
      <m3e-heading level="3" variant="title" size="large">Picture of the day</m3e-heading>
      <m3e-card variant="filled">
        <img src={(feed.image.thumbnail || feed.image.image)?.source} alt={feed.image.description?.text || feed.image.title || 'Picture of the day'} width={(feed.image.thumbnail || feed.image.image)?.width} height={(feed.image.thumbnail || feed.image.image)?.height} loading="lazy" />
        {feed.image.description?.text && <m3e-list-item>{feed.image.description.text}</m3e-list-item>}
        {(feed.image.artist?.name || feed.image.artist?.text) && <m3e-list-item><span slot="supporting-text">{feed.image.artist.name || feed.image.artist.text}{feed.image.credit?.text ? ' ('+feed.image.credit.text.split(';')[0]+')' : ''}</span></m3e-list-item>}
      </m3e-card>
    </>}
    {enabled && feed.news.length > 0 && <>
      <m3e-heading level="3" variant="title" size="large">In the news</m3e-heading>
      {feed.news.map((item,index)=><m3e-card key={index} variant="filled">
        {item.links?.find(link=>link.thumbnail?.source)?.thumbnail?.source && <img src={item.links.find(link=>link.thumbnail?.source)?.thumbnail?.source} alt="" loading="lazy" />}
        <m3e-list-item><WikiFeedStory html={item.story || item.links?.[0]?.title || 'News story'} onOpen={onOpen} /></m3e-list-item>
        {item.links?.slice(0,3).map(link=><m3e-list-item-button key={link.title} onClick={()=>onOpen(link.title)}>{link.title}<m3e-icon slot="trailing" variant="rounded" name="chevron_right"/></m3e-list-item-button>)}
      </m3e-card>)}
    </>}
    {enabled && feed.onthisday.length > 0 && <>
      <m3e-heading level="3" variant="title" size="large">On this day</m3e-heading>
      <m3e-list>
        {feed.onthisday.map((item,index)=><m3e-list-item key={index}>
          <span slot="overline">{item.year ?? ''}</span><span>{item.text || 'Historical event'}</span>
          {item.pages?.slice(0,2).map(page=><m3e-button key={page.title} variant="text" onClick={()=>onOpen(page.title)}>{page.title}</m3e-button>)}
        </m3e-list-item>)}
      </m3e-list>
    </>}
    {!loading && enabled && !feed.featured && feed.trending.length===0 && !feed.image && feed.news.length===0 && feed.onthisday.length===0 && <m3e-card variant="outlined"><m3e-list-item><m3e-icon slot="leading" variant="rounded" name="error" /><span>Today's articles are unavailable</span><span slot="supporting-text">Search Wikipedia or open a random article.</span><m3e-button slot="trailing" variant="filled" onClick={onRandom}>Random</m3e-button></m3e-list-item></m3e-card>}
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
  return <>
    <m3e-list><m3e-list-item><span slot="overline">Article tools</span><m3e-heading level="1" variant="display" size="small" style={{ fontFamily: 'serif' }}>{article.title}</m3e-heading><m3e-icon-button slot="trailing" title="Article contents" onClick={()=>setShowContents(!showContents)}><m3e-icon variant="rounded" name="format_list_bulleted"/></m3e-icon-button></m3e-list-item></m3e-list>
    {showLanguages && <m3e-card variant="outlined"><m3e-list-item>Available article languages</m3e-list-item><m3e-list-item><m3e-search-bar clearable><m3e-icon slot="leading" variant="rounded" name="search"/><input slot="input" aria-label="Search article languages" placeholder="Find language or title" value={languageQuery} onChange={event=>setLanguageQuery(event.target.value)}/></m3e-search-bar></m3e-list-item>{languages.filter(x=>(x.name+' '+x.lang+' '+x.title).toLowerCase().includes(languageQuery.toLowerCase())).map(x=><m3e-list-item-button key={x.lang} selected={x.lang===article.lang} onClick={()=>{setShowLanguages(false);setLanguageQuery('');onChooseLanguage(x.lang,x.title);}}><m3e-icon slot="leading" variant="rounded" name={x.lang===article.lang?'check_circle':'language'}/><span>{x.name||x.lang}</span><span slot="supporting-text">{x.title} · {x.lang}</span></m3e-list-item-button>)}</m3e-card>}
    {showContents && <m3e-card variant="outlined"><m3e-list-item>On this page</m3e-list-item>{headings.length?headings.map(x=><m3e-list-item-button key={x.id} onClick={()=>{document.getElementById(x.id)?.scrollIntoView({behavior:'smooth',block:'start'});setShowContents(false);}}>{x.text}</m3e-list-item-button>):<m3e-list-item>Contents will appear when the article loads.</m3e-list-item>}</m3e-card>}
    <m3e-card variant="outlined">{article.thumbnail?.source&&!dataSaver&&<img src={article.thumbnail.source} alt={article.title} width={article.thumbnail.width} height={article.thumbnail.height} loading="lazy"/>}<m3e-list-item><span slot="overline">Wikipedia article</span><span>{article.title}</span>{article.description&&<span slot="supporting-text">{article.description}</span>}</m3e-list-item>{article.extract&&<m3e-list-item>{article.extract}</m3e-list-item>}</m3e-card>
    {loading&&<m3e-list-item><m3e-circular-progress-indicator indeterminate/>Loading full article…</m3e-list-item>}
    {html&&<ArticleRenderer html={html} lang={article.lang||'en'} dataSaver={dataSaver} expandedSections={expandedSections} fontSize={fontSize} fontStyle={fontStyle} imageBackground={imageBackground} renderMath={renderMath} pageImageUri={article.thumbnail?.source} onLinkClick={title=>{const target=title.trim();if(target)window.dispatchEvent(new CustomEvent('wikireader:open-article',{detail:{title:target,lang:article.lang||'en'}}));}}/>}
    {!loading&&!html&&<m3e-list-item>The full article could not be loaded. A cached copy may be available when you reconnect.</m3e-list-item>}
    <m3e-list-item><m3e-icon slot="leading" variant="rounded" name="check_circle"/>End of article<m3e-button slot="trailing" variant="text" onClick={onBack}>Keep exploring</m3e-button></m3e-list-item>
  </>;
}

function LibraryScreen({ title, entries, total, emptyTitle, emptyText, filter, setFilter, onOpen, onClear, onRemove, clearLabel }: { title: string; entries: Entry[]; total: number; emptyTitle: string; emptyText: string; filter: string; setFilter: (value: string) => void; onOpen: (entry: Entry) => void; onClear: () => void; onRemove: (entry: Entry) => void; clearLabel: string }) {
  return <m3e-list>
    <m3e-list-item><span slot="overline">Your library</span><span>{title}</span><span slot="supporting-text">{total} {total === 1 ? 'article' : 'articles'}</span>{total > 0 && <m3e-button slot="trailing" variant="text" onClick={onClear}>{clearLabel}</m3e-button>}</m3e-list-item>
    {total > 0 && <m3e-list-item><m3e-search-bar clearable><m3e-icon variant="rounded" slot="leading" name="search" /><input slot="input" aria-label="Filter articles" placeholder="Filter articles" value={filter} onChange={event => setFilter(event.target.value)} /></m3e-search-bar></m3e-list-item>}
    {entries.length === 0 && <m3e-list-item><m3e-icon variant="rounded" slot="leading" name="library_books" /><span>{total ? 'No matching articles' : emptyTitle}</span><span slot="supporting-text">{total ? 'Try a different search term.' : emptyText}</span></m3e-list-item>}
    {entries.map(entry => <m3e-list-item-button key={entry.lang + ':' + entry.title} onClick={() => onOpen(entry)}>
      {entry.thumbnail && <img slot="leading" src={entry.thumbnail} alt="" />}
      <span>{entry.title}</span><span slot="supporting-text">{entry.description || entry.lang.toUpperCase() + ' Wikipedia'} · {new Date(entry.visited).toLocaleDateString()}</span>
      <m3e-icon-button slot="trailing" title="Remove article" aria-label={'Remove ' + entry.title + ' from ' + title.toLowerCase()} onClick={event => { event.stopPropagation(); onRemove(entry); }}><m3e-icon variant="rounded" name="close" /></m3e-icon-button>
    </m3e-list-item-button>)}
  </m3e-list>;
}

function SettingsScreen({ prefs, update, languageFilter, setLanguageFilter, onClearData, onReset }: { prefs: Preferences; update: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void; languageFilter: string; setLanguageFilter: (value: string) => void; onClearData: () => void; onReset: () => void }) {
  const [themeOpen,setThemeOpen]=useState(false),[colorsOpen,setColorsOpen]=useState(false),[languageOpen,setLanguageOpen]=useState(false),[clearOpen,setClearOpen]=useState(false),[resetOpen,setResetOpen]=useState(false);
  useEffect(()=>{const reset=()=>setResetOpen(true);window.addEventListener('wikireader:reset-settings',reset);return()=>window.removeEventListener('wikireader:reset-settings',reset);},[]);
  const themes=[['auto','System default'],['light','Light'],['dark','Dark']] as const;
  const colors=['#feb4a7','#ffb3c0','#fcaaff','#b9c3ff','#62d3ff','#44d9f1','#52dbc9','#78dd77','#9fd75c','#c1d02d','#fabd00','#ffb86e','#ffffff'];
  const switches:{key:'dataSaver'|'feedEnabled'|'expandedSections'|'imageBackground'|'immersiveMode'|'renderMath'|'browsingHistory'|'searchHistory';label:string;desc:string}[]=[
    {key:'dataSaver',label:'Data saver',desc:'Avoid loading images to reduce data usage.'},{key:'feedEnabled',label:'Home feed',desc:'Show featured and trending articles on Home.'},{key:'expandedSections',label:'Expanded sections',desc:'Expand article sections by default.'},{key:'imageBackground',label:'Image background',desc:'Display a surface behind article images.'},{key:'immersiveMode',label:'Immersive mode',desc:'Reduce app controls while reading, where supported.'},{key:'renderMath',label:'Render mathematical notation',desc:'Display equations in article content.'},{key:'browsingHistory',label:'Browsing history',desc:'Remember articles you open.'},{key:'searchHistory',label:'Search history',desc:'Keep recent search terms on this device.'}];
  return <>
    <m3e-list>
      <m3e-list-item><span slot="overline">Personalization</span><span>Appearance and reading</span></m3e-list-item>
      <m3e-list-item-button onClick={()=>setColorsOpen(true)}><m3e-icon slot="leading" variant="rounded" name="palette"/><span>Color scheme</span><span slot="supporting-text">{prefs.colorScheme}</span><m3e-icon slot="trailing" variant="rounded" name="chevron_right"/></m3e-list-item-button>
      <m3e-list-item-button onClick={()=>setThemeOpen(true)}><m3e-icon slot="leading" variant="rounded" name="brightness_6"/><span>Theme</span><span slot="supporting-text">{themes.find(x=>x[0]===prefs.theme)?.[1]}</span><m3e-icon slot="trailing" variant="rounded" name="chevron_right"/></m3e-list-item-button>
      <m3e-list-item><m3e-icon slot="leading" variant="rounded" name="brightness_6"/><span>Black theme</span><span slot="supporting-text">Use a black reading theme in dark mode.</span><m3e-switch slot="trailing" checked={prefs.blackTheme} onChange={()=>update('blackTheme',!prefs.blackTheme)}/></m3e-list-item>
    </m3e-list>
    <m3e-list>
      <m3e-list-item><span slot="overline">Reading</span><span>Language and typography</span></m3e-list-item>
      <m3e-list-item-button onClick={()=>setLanguageOpen(true)}><m3e-icon slot="leading" variant="rounded" name="translate"/><span>Wikipedia language</span><span slot="supporting-text">{languages.find(x=>x[0]===prefs.lang)?.[1] || prefs.lang} ({prefs.lang})</span><m3e-icon slot="trailing" variant="rounded" name="chevron_right"/></m3e-list-item-button>
      <m3e-list-item><m3e-icon slot="leading" variant="rounded" name="text_fields"/><span>Font style</span><m3e-button-group slot="trailing" variant="connected"><m3e-button variant={prefs.fontStyle==='sans'?'filled':'outlined'} shape="square" toggle aria-pressed={prefs.fontStyle==='sans'} onClick={()=>update('fontStyle','sans')}>Sans-serif</m3e-button><m3e-button variant={prefs.fontStyle==='serif'?'filled':'outlined'} shape="square" toggle aria-pressed={prefs.fontStyle==='serif'} onClick={()=>update('fontStyle','serif')}>Serif</m3e-button></m3e-button-group></m3e-list-item>
      <m3e-list-item><m3e-icon slot="leading" variant="rounded" name="format_size"/><span>Article font size</span><span slot="supporting-text">{prefs.fontSize} sp</span></m3e-list-item>
      <m3e-list-item><m3e-slider min={10} max={22} step={1} discrete labelled onInput={event=>{const thumb=(event.currentTarget as HTMLElement).querySelector<HTMLElement & {value?:number}>('m3e-slider-thumb');const value=Number(thumb?.value ?? thumb?.getAttribute('value') ?? prefs.fontSize);if(Number.isFinite(value))update('fontSize',Math.max(10,Math.min(22,Math.round(value))));}}><m3e-slider-thumb value={prefs.fontSize}/></m3e-slider></m3e-list-item>
      </m3e-list>
      <m3e-list>
      <m3e-list-item><span slot="overline">Behavior</span><span>Reading and privacy</span></m3e-list-item>
      {switches.map(item=><m3e-list-item key={item.key}><m3e-icon slot="leading" variant="rounded" name="tune"/><span>{item.label}</span><span slot="supporting-text">{item.desc}</span><m3e-switch slot="trailing" checked={Boolean(prefs[item.key])} disabled={item.key==='feedEnabled'&&prefs.dataSaver} onChange={()=>update(item.key,!prefs[item.key] as Preferences[typeof item.key])}/></m3e-list-item>)}
      <m3e-list-item><m3e-icon slot="leading" variant="rounded" name="delete"/><span>Local data</span><span slot="supporting-text">Clear saved articles, history, searches, and cached pages from this device.</span><m3e-button slot="trailing" variant="outlined" onClick={()=>setClearOpen(true)}>Clear data</m3e-button></m3e-list-item>
    </m3e-list>
    <m3e-list>
      <m3e-card variant="outlined"><m3e-list-item><m3e-icon slot="leading" variant="rounded" name="info"/><span>Set as default</span><span slot="supporting-text">Configure your desktop system to open Wikipedia links with WikiReader.</span></m3e-list-item><m3e-list-item><m3e-button variant="text" onClick={()=>window.open('https://gist.github.com/nsh07/ed7571f3e2014b412037626a39d68ecd','_blank','noopener,noreferrer')}>Instructions</m3e-button></m3e-list-item></m3e-card>
    </m3e-list>
    {themeOpen && <m3e-dialog open dismissible close-label="Close theme options"><span slot="header">Theme</span><m3e-list>{themes.map(x=><m3e-list-item-button key={x[0]} selected={prefs.theme===x[0]} onClick={()=>update('theme',x[0])}><m3e-icon slot="leading" variant="rounded" name={prefs.theme===x[0]?'radio_button_checked':'radio_button_unchecked'}/>{x[1]}</m3e-list-item-button>)}</m3e-list><m3e-list-item slot="actions"><m3e-button variant="text" onClick={()=>setThemeOpen(false)}>Close</m3e-button></m3e-list-item></m3e-dialog>}
    {colorsOpen && <m3e-dialog open dismissible close-label="Close color schemes"><span slot="header">Choose color scheme</span><m3e-list>{colors.map(color=><m3e-list-item-button key={color} selected={prefs.colorScheme===color} onClick={()=>update('colorScheme',color)}><m3e-icon slot="leading" variant="rounded" name={prefs.colorScheme===color?'radio_button_checked':'radio_button_unchecked'}/>{color==='#ffffff'?'Dynamic color':color}</m3e-list-item-button>)}</m3e-list><m3e-list-item slot="actions"><m3e-button variant="text" onClick={()=>setColorsOpen(false)}>Done</m3e-button></m3e-list-item></m3e-dialog>}
    <LanguagePickerDialog open={languageOpen} filter={languageFilter} setFilter={setLanguageFilter} currentLang={prefs.lang} title="Wikipedia language" onClose={()=>setLanguageOpen(false)} onChoose={target=>{update('lang',target);setLanguageFilter('');setLanguageOpen(false);}}/>
    {clearOpen && <m3e-dialog open dismissible close-label="Cancel clearing data"><span slot="header">Clear local data?</span><m3e-list-item>This removes saved articles, history, search history, and cached article pages.</m3e-list-item><m3e-list-item slot="actions"><m3e-button variant="text" onClick={()=>setClearOpen(false)}>Cancel</m3e-button><m3e-button variant="filled" onClick={()=>{onClearData();setClearOpen(false);}}>Clear data</m3e-button></m3e-list-item></m3e-dialog>}
    {resetOpen && <m3e-dialog open dismissible close-label="Cancel resetting settings"><span slot="header">Reset settings?</span><m3e-list-item>Preferences return to defaults. Saved articles and history are kept.</m3e-list-item><m3e-list-item slot="actions"><m3e-button variant="text" onClick={()=>setResetOpen(false)}>Cancel</m3e-button><m3e-button variant="filled" onClick={()=>{onReset();setResetOpen(false);}}>Reset</m3e-button></m3e-list-item></m3e-dialog>}
  </>;
}
function LanguagePickerDialog({open,filter,setFilter,currentLang,title,onClose,onChoose}:{open:boolean;filter:string;setFilter:(value:string)=>void;currentLang:string;title:string;onClose:()=>void;onChoose:(lang:string)=>void}) {
 return <m3e-dialog open={open} dismissible close-label="Close language chooser"><span slot="header">{title}</span><m3e-list-item><m3e-search-bar clearable><m3e-icon slot="leading" variant="rounded" name="search"/><input slot="input" aria-label="Find Wikipedia language" placeholder="Search languages" value={filter} onChange={event=>setFilter(event.target.value)}/></m3e-search-bar></m3e-list-item><m3e-list>{languages.filter(x=>(x[0]+' '+x[1]).toLowerCase().includes(filter.toLowerCase())).map(x=><m3e-list-item-button key={x[0]} selected={currentLang===x[0]} onClick={()=>onChoose(x[0])}><m3e-icon slot="leading" variant="rounded" name={currentLang===x[0]?'radio_button_checked':'radio_button_unchecked'}/><span>{x[1]}</span><span slot="supporting-text">{x[0]}</span></m3e-list-item-button>)}</m3e-list><m3e-list-item slot="actions"><m3e-button variant="text" onClick={onClose}>Close</m3e-button></m3e-list-item></m3e-dialog>;
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
