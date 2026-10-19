import { useCallback, useEffect, useMemo, useState } from 'react';

type Page = { title: string; description?: string; extract?: string; thumbnail?: { source: string; width?: number; height?: number }; pageid?: number; lang?: string };
type Entry = { title: string; lang: string; visited: number; description?: string; thumbnail?: string };
type Section = 'home' | 'history' | 'saved' | 'settings' | 'about';
const readStore = <T,>(key: string, fallback: T): T => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; } };
const writeStore = (key: string, value: unknown) => localStorage.setItem(key, JSON.stringify(value));
type CachedArticle = { html: string; savedAt: number };
const ARTICLE_CACHE_KEY = 'wr-article-cache';
const getCachedArticle = (lang: string, title: string): string => {
  try {
    const cache = readStore<Record<string, CachedArticle>>(ARTICLE_CACHE_KEY, {});
    return cache[`${lang}:${title}`]?.html ?? '';
  } catch { return ''; }
};
const cacheArticle = (lang: string, title: string, html: string) => {
  // Keep the cache bounded so localStorage remains available for settings/history.
  if (!html || html.length > 350_000) return;
  try {
    const cache = readStore<Record<string, CachedArticle>>(ARTICLE_CACHE_KEY, {});
    cache[`${lang}:${title}`] = { html, savedAt: Date.now() };
    const recent = Object.entries(cache).sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, 5);
    writeStore(ARTICLE_CACHE_KEY, Object.fromEntries(recent));
  } catch { /* A full browser storage quota must not interrupt reading. */ }
};
const titleToPath = (title: string) => encodeURIComponent(title.replaceAll(' ', '_'));
const api = async <T,>(url: string): Promise<T> => { const response = await fetch(url, { headers: { 'Api-User-Agent': 'WikiReader/2.5.5 (desktop reader)' } }); if (!response.ok) throw new Error(`Wikipedia returned ${response.status}`); return response.json() as Promise<T>; };

export default function App() {
  const [section, setSection] = useState<Section>('home');
  const [lang, setLang] = useState(() => readStore('wr-lang', 'en'));
  const [scheme, setScheme] = useState(() => readStore('wr-scheme', 'auto'));
  const [accent, setAccent] = useState(() => readStore('wr-accent', '#6750a4'));
  const [immersive, setImmersive] = useState(() => readStore('wr-immersive', false));
  const [history, setHistory] = useState<Entry[]>(() => readStore('wr-history', []));
  const [saved, setSaved] = useState<Entry[]>(() => readStore('wr-saved', []));
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Page[]>([]);
  const [searching, setSearching] = useState(false);
  const [feed, setFeed] = useState<Page[]>([]);
  const [article, setArticle] = useState<Page | null>(null);
  const [articleHtml, setArticleHtml] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [stack, setStack] = useState<string[]>([]);
  const [showContents, setShowContents] = useState(false);
  const [fontScale, setFontScale] = useState(() => readStore('wr-font-scale', 100));

  useEffect(() => { writeStore('wr-lang', lang); }, [lang]);
  useEffect(() => { writeStore('wr-scheme', scheme); }, [scheme]);
  useEffect(() => { writeStore('wr-accent', accent); }, [accent]);
  useEffect(() => { writeStore('wr-immersive', immersive); }, [immersive]);
  useEffect(() => { writeStore('wr-history', history); }, [history]);
  useEffect(() => { writeStore('wr-saved', saved); }, [saved]);
  useEffect(() => { writeStore('wr-font-scale', fontScale); }, [fontScale]);

  useEffect(() => {
    let active = true;
    api<{ tfa?: Page; mostread?: { articles?: Page[] } }>(`https://${lang}.wikipedia.org/api/rest_v1/feed/featured/${new Date().toISOString().slice(0,10).replaceAll('-', '/')}`)
      .then(data => { if (active) setFeed([...(data.tfa ? [data.tfa] : []), ...(data.mostread?.articles ?? []).slice(0, 12)]); })
      .catch(() => { if (active) setFeed([]); });
    return () => { active = false; };
  }, [lang]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setSuggestions([]); setSearching(false); return; }
    let active = true;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const data = await api<{ query?: { pages?: { title: string; pageid: number; thumbnail?: { source: string }; terms?: { description?: string[] } }[] } }>(`https://${lang}.wikipedia.org/w/api.php?action=query&generator=prefixsearch&gpssearch=${encodeURIComponent(q)}&gpslimit=8&prop=pageimages%7Cpageterms&piprop=thumbnail&pithumbsize=100&wbptterms=description&format=json&formatversion=2&origin=*`);
        if (active) setSuggestions((data.query?.pages ?? []).map(p => ({ title: p.title, pageid: p.pageid, thumbnail: p.thumbnail, description: p.terms?.description?.[0] })));
      } catch { if (active) setSuggestions([]); } finally { if (active) setSearching(false); }
    }, 220);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, lang]);

  const openArticle = useCallback(async (title: string, push = true, requestedLang = lang) => {
    setError(''); setLoading(true); setSection('home'); setQuery(''); setSuggestions([]); setShowContents(false);
    try {
      const data = await api<Page>(`https://${requestedLang}.wikipedia.org/api/rest_v1/page/summary/${titleToPath(title)}`);
      setArticle({ ...data, lang: requestedLang }); setArticleHtml('');
      if (push) setStack(prev => [...prev, data.title || title]);
      const entry: Entry = { title: data.title || title, lang: requestedLang, visited: Date.now(), description: data.description, thumbnail: data.thumbnail?.source };
      setHistory(prev => [entry, ...prev.filter(e => !(e.title === entry.title && e.lang === requestedLang))].slice(0, 500));
      try {
        const response = await fetch(`https://${requestedLang}.wikipedia.org/api/rest_v1/page/html/${titleToPath(data.title || title)}`, { headers: { 'Api-User-Agent': 'WikiReader/2.5.5 (desktop reader)' } });
        if (response.ok) {
          const html = await response.text();
          setArticleHtml(html);
          cacheArticle(requestedLang, data.title || title, html);
        } else {
          setArticleHtml(getCachedArticle(requestedLang, data.title || title));
        }
      } catch {
        // Use the last successfully rendered page when the network is unavailable.
        setArticleHtml(getCachedArticle(requestedLang, data.title || title));
      }
    } catch (e) {
      const cachedHtml = getCachedArticle(requestedLang, title);
      if (cachedHtml) {
        setArticle({ title, lang: requestedLang });
        setArticleHtml(cachedHtml);
        if (push) setStack(prev => [...prev, title]);
        const entry: Entry = { title, lang: requestedLang, visited: Date.now() };
        setHistory(prev => [entry, ...prev.filter(item => !(item.title === title && item.lang === requestedLang))].slice(0, 500));
      } else {
        setError(e instanceof Error ? e.message : 'Could not load this article.');
      }
    }
    finally { setLoading(false); }
  }, [lang]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const link = target?.closest('a') as HTMLAnchorElement | null;
      if (!link || !article) return;
      const href = link.getAttribute('href') || '';
      if (href.startsWith('./') || href.startsWith('/wiki/')) {
        event.preventDefault(); const title = decodeURIComponent(href.replace(/^\.\//, '').replace(/^\/wiki\//, '').split('#')[0]).replaceAll('_', ' '); if (title) void openArticle(title);
      } else if (href.startsWith('http')) {
        try { const url = new URL(href); if (url.hostname.endsWith('wikipedia.org') && url.pathname.startsWith('/wiki/')) { event.preventDefault(); void openArticle(decodeURIComponent(url.pathname.slice(6)).replaceAll('_', ' ')); } } catch { /* keep external links as links */ }
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [article, openArticle]);

  const isSaved = article ? saved.some(e => e.title === article.title && e.lang === lang) : false;
  const toggleSaved = () => { if (!article) return; const entry: Entry = { title: article.title, lang, visited: Date.now(), description: article.description, thumbnail: article.thumbnail?.source }; setSaved(prev => isSaved ? prev.filter(e => !(e.title === entry.title && e.lang === lang)) : [entry, ...prev]); };
  const doSearch = () => { const value = query.trim(); if (value) void openArticle(value); };
  const back = () => { if (stack.length > 1) { const prev = stack[stack.length - 2]; setStack(s => s.slice(0, -1)); void openArticle(prev, false); } else { setArticle(null); setArticleHtml(''); } };
  const randomArticle = async () => { try { const data = await api<{ query?: { pages?: { title: string }[] } }>(`https://${lang}.wikipedia.org/w/api.php?action=query&generator=random&grnnamespace=0&grnlimit=1&format=json&formatversion=2&origin=*`); const title = data.query?.pages?.[0]?.title; if (title) void openArticle(title); } catch { setError('Unable to get a random article right now.'); } };
  const pageTitle = useMemo(() => article?.title ?? 'Explore Wikipedia', [article]);

  return <m3e-theme color={accent} scheme={scheme} variant="tonal-spot" motion="expressive" className="theme-root">
    <div className={`app-shell ${immersive ? 'immersive' : ''}`}>
      <aside className="rail">
        <div className="brand-mark"><m3e-icon name="menu_book" filled /></div>
        <div className="rail-items">
          <RailButton icon="home" label="Home" active={section === 'home'} onClick={() => { setSection('home'); if (article) { setArticle(null); setArticleHtml(''); setStack([]); } }} />
          <RailButton icon="history" label="History" active={section === 'history'} onClick={() => setSection('history')} />
          <RailButton icon="bookmark" label="Saved" active={section === 'saved'} onClick={() => setSection('saved')} />
        </div>
        <div className="rail-bottom"><RailButton icon="settings" label="Settings" active={section === 'settings'} onClick={() => setSection('settings')} /><RailButton icon="info" label="About" active={section === 'about'} onClick={() => setSection('about')} /></div>
      </aside>
      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-title"><div className="eyebrow">WIKIPEDIA READER</div><h1>{section === 'home' ? pageTitle : ({history:'Reading history', saved:'Saved articles', settings:'Settings', about:'About WikiReader'} as Record<Section,string>)[section]}</h1></div>
          <div className="topbar-actions"><label className="language-select"><m3e-icon name="language"/><select aria-label="Wikipedia language" value={lang} onChange={e => { setLang(e.target.value); setArticle(null); setArticleHtml(''); setStack([]); }}><option value="en">English</option><option value="es">Español</option><option value="fr">Français</option><option value="de">Deutsch</option><option value="it">Italiano</option><option value="pt">Português</option><option value="ja">日本語</option><option value="zh">中文</option><option value="ru">Русский</option><option value="ar">العربية</option></select></label><m3e-icon-button title="Random article" onClick={randomArticle}><m3e-icon name="shuffle"/></m3e-icon-button></div>
        </header>
        <div className="search-wrap"><m3e-search-bar clearable className="search-bar"><m3e-icon slot="leading" name="search"/><input slot="input" aria-label="Search Wikipedia" placeholder={`Search ${lang === 'en' ? 'Wikipedia' : `${lang} Wikipedia`}…`} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && doSearch()} /><m3e-icon-button slot="trailing" title="Search" onClick={doSearch}><m3e-icon name="arrow_forward"/></m3e-icon-button></m3e-search-bar>
          {query.trim().length > 1 && <div className="suggestions">{searching && <div className="suggestion-status"><m3e-progress-indicator indeterminate/> Searching…</div>}{suggestions.map(s => <button className="suggestion" key={s.pageid ?? s.title} onClick={() => void openArticle(s.title)}>{s.thumbnail ? <img src={s.thumbnail.source} /> : <span className="suggestion-icon"><m3e-icon name="article"/></span>}<span><strong>{s.title}</strong><small>{s.description || 'Wikipedia article'}</small></span><m3e-icon name="arrow_outward"/></button>)}{!searching && suggestions.length === 0 && <div className="suggestion-status">No matches. Press Enter to open “{query}”.</div>}</div>}
        </div>
        {error && <div className="error-banner"><m3e-icon name="error"/>{error}<m3e-button variant="text" onClick={() => setError('')}>Dismiss</m3e-button></div>}
        <div className="workspace">
          {section === 'home' && (article ? <ArticleView article={article} html={articleHtml} loading={loading} isSaved={isSaved} onBack={back} onSave={toggleSaved} showContents={showContents} setShowContents={setShowContents} fontScale={fontScale} /> : <HomeView feed={feed} loading={feed.length === 0} onOpen={title => void openArticle(title)} onRandom={randomArticle} />)}
          {section === 'history' && <EntryList entries={history} emptyIcon="history" emptyTitle="Your reading history is empty" emptyText="Articles you read will appear here." actionLabel="Clear history" onAction={() => setHistory([])} onOpen={e => { setLang(e.lang); void openArticle(e.title, true, e.lang); }} />}
          {section === 'saved' && <EntryList entries={saved} emptyIcon="bookmark" emptyTitle="No saved articles yet" emptyText="Save articles while reading to keep them close at hand." actionLabel="Remove all" onAction={() => setSaved([])} onOpen={e => { setLang(e.lang); void openArticle(e.title); }} onRemove={e => setSaved(prev => prev.filter(x => x.title !== e.title || x.lang !== e.lang))} />}
          {section === 'settings' && <div className="settings-page"><section className="settings-intro"><span className="section-kicker">PERSONALIZE</span><h2>Make reading yours</h2><p>Adjust the reading environment to your preferences.</p></section><m3e-card variant="outlined" className="settings-card"><div className="setting-row"><div className="setting-icon"><m3e-icon name="contrast"/></div><div className="setting-copy"><strong>Appearance</strong><span>Choose your preferred color scheme</span></div><select value={scheme} onChange={e => setScheme(e.target.value)}><option value="auto">System</option><option value="light">Light</option><option value="dark">Dark</option></select></div><m3e-divider/><div className="setting-row"><div className="setting-icon"><m3e-icon name="palette"/></div><div className="setting-copy"><strong>Accent color</strong><span>Color used for highlights and controls</span></div><div className="swatches">{['#6750a4','#006a6a','#8c4a60','#415f91','#795900'].map(c => <button aria-label={`Set accent ${c}`} key={c} className={`swatch ${accent === c ? 'chosen' : ''}`} style={{background:c}} onClick={() => setAccent(c)}/>)}</div></div><m3e-divider/><div className="setting-row"><div className="setting-icon"><m3e-icon name="format_size"/></div><div className="setting-copy"><strong>Article text size</strong><span>Adjust the size of article content</span></div><div className="font-controls"><m3e-icon-button title="Decrease text size" disabled={fontScale <= 80} onClick={() => setFontScale(v => Math.max(80, v - 10))}><m3e-icon name="remove"/></m3e-icon-button><strong>{fontScale}%</strong><m3e-icon-button title="Increase text size" disabled={fontScale >= 140} onClick={() => setFontScale(v => Math.min(140, v + 10))}><m3e-icon name="add"/></m3e-icon-button></div></div><m3e-divider/><div className="setting-row"><div className="setting-icon"><m3e-icon name="visibility"/></div><div className="setting-copy"><strong>Immersive mode</strong><span>Hide extra chrome and focus on the article</span></div><m3e-switch checked={immersive} onClick={() => setImmersive(v => !v)}/></div></m3e-card><m3e-card variant="outlined" className="settings-card"><div className="setting-row"><div className="setting-icon"><m3e-icon name="database"/></div><div className="setting-copy"><strong>Local data</strong><span>History and saved articles are stored on this device.</span></div><m3e-button variant="outlined" onClick={() => { setHistory([]); setSaved([]); }}>Clear data</m3e-button></div></m3e-card><p className="settings-footnote">WikiReader is an independent reader and is not affiliated with the Wikimedia Foundation.</p></div>}
          {section === 'about' && <div className="about-page"><div className="about-logo"><m3e-icon name="menu_book" filled/></div><span className="section-kicker">ABOUT THE APP</span><h2>WikiReader</h2><p className="about-lede">A calmer way to explore the world’s knowledge.</p><m3e-card variant="outlined" className="about-card"><div className="about-row"><span>Version</span><strong>2.5.5 desktop</strong></div><m3e-divider/><div className="about-row"><span>Reading content</span><strong>Wikipedia</strong></div><m3e-divider/><div className="about-row"><span>Interface</span><strong>M3E components</strong></div><m3e-divider/><p>Article text, images, and metadata are provided by Wikipedia and Wikimedia projects. Wikipedia content is available under its respective open licenses.</p><m3e-button variant="tonal" href="https://www.wikipedia.org/" target="_blank"><m3e-icon slot="icon" name="open_in_new"/>Visit Wikipedia</m3e-button></m3e-card></div>}
        </div>
        <footer className="statusbar"><span><span className="status-dot"/> Connected to Wikipedia</span><span>WikiReader · Desktop</span></footer>
      </main>
    </div>
  </m3e-theme>;
}

function RailButton({icon,label,active,onClick}:{icon:string;label:string;active:boolean;onClick:()=>void}) { return <button className={`rail-button ${active?'active':''}`} onClick={onClick} title={label}><span className="rail-icon"><m3e-icon name={icon} filled={active}/></span><span>{label}</span></button>; }
function HomeView({feed,loading,onOpen,onRandom}:{feed:Page[];loading:boolean;onOpen:(t:string)=>void;onRandom:()=>void}) {
  const lead = feed[0]; const cards = feed.slice(1, 10);
  return <div className="home-page"><section className="welcome-block"><div className="welcome-copy"><span className="section-kicker">YOUR DAILY DOSE OF KNOWLEDGE</span><h2>Curiosity looks good on you.</h2><p>Follow a question. Discover a connection. Let one article lead to another.</p><m3e-button variant="filled" onClick={onRandom}><m3e-icon slot="icon" name="shuffle"/>Surprise me</m3e-button></div><div className="welcome-art"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="book-illustration"><m3e-icon name="menu_book" filled/></div><span className="spark spark-a">✦</span><span className="spark spark-b">✧</span></div></section>
    {loading ? <div className="feed-loading"><m3e-progress-indicator indeterminate/><span>Finding today’s featured articles…</span></div> : <>{lead && <section className="featured-section"><div className="section-heading"><div><span className="section-kicker">FEATURED TODAY</span><h2>Worth a closer look</h2></div><span className="date-label">{new Date().toLocaleDateString(undefined,{month:'long',day:'numeric'})}</span></div><m3e-card variant="outlined" className="featured-card" onClick={() => onOpen(lead.title)}>{lead.thumbnail?.source && <img className="featured-image" src={lead.thumbnail.source} alt=""/>}<div className="featured-content"><span className="featured-label"><m3e-icon name="auto_awesome"/> TODAY’S FEATURE</span><h3>{lead.title}</h3><p>{lead.description || lead.extract || 'Explore the story behind this featured Wikipedia article.'}</p><m3e-button variant="tonal" onClick={e => {e.stopPropagation(); onOpen(lead.title);}}>Read article <m3e-icon slot="trailing-icon" name="arrow_forward"/></m3e-button></div></m3e-card></section>}
      <section className="discover-section"><div className="section-heading"><div><span className="section-kicker">KEEP EXPLORING</span><h2>More to discover</h2></div><span className="quiet-label">From Wikipedia</span></div><div className="article-grid">{cards.map((p,i)=><m3e-card key={p.title} variant="outlined" className="discovery-card" onClick={() => onOpen(p.title)}>{p.thumbnail?.source ? <img src={p.thumbnail.source} alt="" loading="lazy"/> : <div className={`card-placeholder tint-${i%4}`}><m3e-icon name={['public','science','history_edu','landscape'][i%4]}/></div>}<div className="discovery-copy"><span className="card-category">{p.description || 'DID YOU KNOW?'}</span><h3>{p.title}</h3><p>{p.extract || 'Open this article to learn more.'}</p><span className="read-link">Read article <m3e-icon name="arrow_forward"/></span></div></m3e-card>)}</div></section></>}
  </div>;
}
function ArticleView({article,html,loading,isSaved,onBack,onSave,showContents,setShowContents,fontScale}:{article:Page;html:string;loading:boolean;isSaved:boolean;onBack:()=>void;onSave:()=>void;showContents:boolean;setShowContents:(v:boolean)=>void;fontScale:number}) {
  const headings = useMemo(() => { if (!html) return []; const doc = new DOMParser().parseFromString(html,'text/html'); return [...doc.querySelectorAll('h2,h3')].map((h,i)=>({id:h.id || `heading-${i}`,text:h.textContent?.replace('[edit]','').trim() || ''})).filter(h=>h.text); },[html]);
  return <div className="reader-page"><div className="reader-toolbar"><m3e-button variant="text" onClick={onBack}><m3e-icon slot="icon" name="arrow_back"/>Back</m3e-button><div className="reader-actions"><m3e-icon-button title="Article contents" onClick={() => setShowContents(!showContents)}><m3e-icon name="format_list_bulleted"/></m3e-icon-button><m3e-icon-button title={isSaved?'Remove from saved':'Save article'} onClick={onSave}><m3e-icon name="bookmark" filled={isSaved}/></m3e-icon-button><m3e-icon-button title="Open on Wikipedia" onClick={() => window.open(`https://${article.lang || 'en'}.wikipedia.org/wiki/${titleToPath(article.title)}`,'_blank','noopener,noreferrer')}><m3e-icon name="open_in_new"/></m3e-icon-button></div></div>
    {showContents && <div className="contents-panel"><strong>On this page</strong>{headings.length ? headings.map(h=><button key={h.id} onClick={() => {document.getElementById(h.id)?.scrollIntoView({behavior:'smooth',block:'start'});setShowContents(false);}}>{h.text}</button>) : <span>Contents will appear when the article loads.</span>}</div>}
    <article className="article-reading" style={{'--article-scale':fontScale/100} as React.CSSProperties}><div className="article-eyebrow"><m3e-icon name="public"/> WIKIPEDIA ARTICLE</div><h1>{article.title}</h1>{article.description && <p className="article-description">{article.description}</p>}{article.thumbnail?.source && <figure className="article-lead-image"><img src={article.thumbnail.source} alt=""/><figcaption>Image from Wikimedia Commons / Wikipedia</figcaption></figure>}{article.extract && <p className="article-extract">{article.extract}</p>}{loading && <div className="reader-loading"><m3e-progress-indicator indeterminate/> Loading article…</div>}{html && <div className="wiki-content" dangerouslySetInnerHTML={{__html:html}}/>}{!loading && !html && <div className="article-fallback"><p>The article summary is available, but the full article could not be loaded right now.</p><m3e-button variant="tonal" href={`https://${article.lang || 'en'}.wikipedia.org/wiki/${titleToPath(article.title)}`} target="_blank">Read on Wikipedia</m3e-button></div>}<div className="article-end"><m3e-icon name="check_circle"/><span>You’ve reached the end of this article.</span><m3e-button variant="text" onClick={onBack}>Keep exploring</m3e-button></div></article>
  </div>;
}
function EntryList({entries,emptyIcon,emptyTitle,emptyText,actionLabel,onAction,onOpen,onRemove}:{entries:Entry[];emptyIcon:string;emptyTitle:string;emptyText:string;actionLabel:string;onAction:()=>void;onOpen:(e:Entry)=>void;onRemove?:(e:Entry)=>void}) {
  const [filter,setFilter] = useState(''); const filtered = entries.filter(e => `${e.title} ${e.description || ''}`.toLowerCase().includes(filter.toLowerCase()));
  return <div className="list-page"><div className="list-heading"><div><span className="section-kicker">YOUR LIBRARY</span><h2>{entries.length} {entries.length===1?'article':'articles'}</h2></div>{entries.length>0 && <m3e-button variant="text" onClick={onAction}>{actionLabel}</m3e-button>}</div>{entries.length>0 && <div className="list-filter"><m3e-icon name="search"/><input placeholder="Filter articles…" value={filter} onChange={e=>setFilter(e.target.value)}/></div>}{filtered.length===0 ? <div className="empty-state"><div className="empty-icon"><m3e-icon name={emptyIcon}/></div><h2>{entries.length ? 'No matching articles' : emptyTitle}</h2><p>{entries.length ? 'Try another search term.' : emptyText}</p></div> : <div className="entry-list">{filtered.map(e=><div className="entry-row" key={`${e.lang}:${e.title}`}><button className="entry-main" onClick={()=>onOpen(e)}>{e.thumbnail ? <img src={e.thumbnail} alt=""/> : <span className="entry-placeholder"><m3e-icon name="article"/></span>}<span className="entry-details"><strong>{e.title}</strong><small>{e.description || `${e.lang.toUpperCase()} Wikipedia`} · {new Date(e.visited).toLocaleDateString()}</small></span><m3e-icon name="chevron_right"/></button>{onRemove && <m3e-icon-button title="Remove saved article" onClick={()=>onRemove(e)}><m3e-icon name="bookmark_remove"/></m3e-icon-button>}</div>)}</div>}</div>;
}
