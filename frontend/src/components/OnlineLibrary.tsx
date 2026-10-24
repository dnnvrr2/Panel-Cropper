import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Crop, Globe, LoaderCircle, RefreshCw, Search, Settings2 } from "lucide-react";
import { onlineApi } from "../services/onlineApi";
import { useProjectStore } from "../stores/projectStore";
import type { OnlineBrowseSpec, OnlineCategory, OnlineChapter, OnlineChapterNavigation, OnlineConnection, OnlineSeries, OnlineSource } from "../types/online";
import { chapterOrder } from "../utils/chapterOrder";

const message = (error: unknown) => error instanceof Error ? error.message : "Could not load online content.";
const aborted = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

function Cover({ series, serverUrl }: { series: OnlineSeries; serverUrl: string }) {
  const [failed, setFailed] = useState(false);
  return <div className="online-cover">
    {failed ? <BookOpen size={32} /> : <img src={onlineApi.coverUrl(series.id, serverUrl)} alt=""
      loading="lazy" decoding="async" onError={() => setFailed(true)} />}
  </div>;
}

export function OnlineLibrary({ hidden, onClose, onNavigationChange }: {
  hidden: boolean; onClose: () => void; onNavigationChange: (navigation: OnlineChapterNavigation | null) => void;
}) {
  const [view, setView] = useState<"browse" | "series">("browse");
  const [connection, setConnection] = useState<OnlineConnection | null>(null);
  const [serverUrl, setServerUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sources, setSources] = useState<OnlineSource[]>([]);
  const [source, setSource] = useState("all");
  const [language, setLanguage] = useState("en");
  const [query, setQuery] = useState("");
  const [searchSpec, setSearchSpec] = useState<OnlineBrowseSpec | null>(null);
  const [categories, setCategories] = useState<OnlineCategory[]>([]);
  const [category, setCategory] = useState("");
  const [mode, setMode] = useState<"popular" | "latest">("popular");
  const [genre, setGenre] = useState("");
  const [genres, setGenres] = useState<string[]>([]);
  const [genreHints, setGenreHints] = useState<string[]>([]);
  const [genreLoading, setGenreLoading] = useState(false);
  const [results, setResults] = useState<OnlineSeries[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [series, setSeries] = useState<OnlineSeries | null>(null);
  const [chapters, setChapters] = useState<OnlineChapter[]>([]);
  const [chapter, setChapter] = useState<OnlineChapter | null>(null);
  const [chapterFilter, setChapterFilter] = useState("");
  const [scanlatorFilter, setScanlatorFilter] = useState("all");
  const [oldestFirst, setOldestFirst] = useState(true);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const browserAbort = useRef<AbortController | null>(null);
  const browseScroll = useRef<HTMLDivElement>(null);
  const seriesScroll = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const mounted = useRef(true);
  const project = useProjectStore((state) => state.project);
  const busy = useProjectStore((state) => state.busy);
  const storeError = useProjectStore((state) => state.error);
  const importOnlineChapter = useProjectStore((state) => state.importOnlineChapter);
  const importFeedback = useProjectStore((state) => state.importFeedback);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; initialized.current = false; browserAbort.current?.abort(); };
  }, []);

  const newRequest = () => {
    browserAbort.current?.abort();
    const controller = new AbortController();
    browserAbort.current = controller;
    setError(null);
    setNotice(null);
    return controller;
  };

  const connect = async (save: boolean) => {
    const controller = newRequest();
    setConnecting(true);
    setLoading(false);
    try {
      const config = save ? await onlineApi.configure(serverUrl, username, password || undefined)
        : await onlineApi.connection(controller.signal);
      if (controller.signal.aborted) return;
      setConnection(config);
      setServerUrl(config.serverUrl);
      setUsername(config.username);
      setPassword("");
      if (save) {
        setView("browse"); setSeries(null); setChapter(null); setChapters([]);
        setResults([]); setSearchSpec(null); setHasMore(false);
        setCategory(""); setGenre(""); setMode("popular");
      }
      const available = await onlineApi.sources(controller.signal);
      if (controller.signal.aborted) return;
      setSources(available);
      try {
        const libraryCategories = await onlineApi.categories(controller.signal);
        if (!controller.signal.aborted) setCategories(libraryCategories);
      } catch (cause) {
        if (!controller.signal.aborted) { setCategories([]); setNotice(`Could not load library categories: ${message(cause)}`); }
      }
      if (controller.signal.aborted) return;
      setSettingsOpen(false);
    } catch (cause) {
      if (!aborted(cause) && !controller.signal.aborted) {
        setError(message(cause)); setSettingsOpen(true); setSources([]);
      }
    } finally {
      if (!controller.signal.aborted && mounted.current) setConnecting(false);
    }
  };

  useEffect(() => {
    if (!hidden && !initialized.current) { initialized.current = true; void connect(false); }
  }, [hidden]);

  useEffect(() => {
    if (!connection) return;
    const controller = new AbortController();
    setGenres([]); setGenreHints([]); setGenreLoading(true);
    onlineApi.genres(source, source === "library" ? category : "", controller.signal)
      .then((data) => { if (!controller.signal.aborted) { setGenres(data.genres); setGenreHints(data.hints); } })
      .catch((cause) => { if (!controller.signal.aborted) setGenreHints([`Could not load genres: ${message(cause)}`]); })
      .finally(() => { if (!controller.signal.aborted) setGenreLoading(false); });
    return () => controller.abort();
  }, [connection, source, category]);

  const search = async (nextPage = 1, spec: OnlineBrowseSpec = { query: query.trim(), source, language, mode, category, genre }) => {
    const controller = newRequest();
    setLoading(true);
    if (nextPage === 1) { setResults([]); setSearchSpec(spec); setHasMore(false); }
    try {
      const result = await onlineApi.search(spec, nextPage, controller.signal);
      if (controller.signal.aborted) return;
      setResults((previous) => {
        const combined = nextPage === 1 ? result.mangaList : [...previous, ...result.mangaList];
        return [...new Map(combined.map((item) => [item.id, item])).values()];
      });
      setPage(nextPage);
      setHasMore(result.hasNextPage);
      if (result.failures.length) setNotice(`Some sources could not load: ${result.failures.map((item) => item.source).join(", ")}. Other results are shown below.`);
      if (nextPage === 1) browseScroll.current?.scrollTo(0, 0);
    } catch (cause) {
      if (!aborted(cause) && !controller.signal.aborted) setError(message(cause));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  const openSeries = async (item: OnlineSeries) => {
    const controller = newRequest();
    setView("series"); setSeries(item); setChapters([]); setChapterFilter(""); setScanlatorFilter("all"); setChapter(null);
    setLoading(true);
    seriesScroll.current?.scrollTo(0, 0);
    const outcomes = await Promise.allSettled([
      onlineApi.series(item.id, controller.signal), onlineApi.chapters(item.id, false, controller.signal),
    ]);
    if (controller.signal.aborted) return;
    const [info, list] = outcomes;
    if (info.status === "fulfilled") setSeries(info.value);
    if (list.status === "fulfilled") setChapters(list.value);
    const failed = outcomes.filter((outcome) => outcome.status === "rejected");
    if (failed.length) setError(failed.map((outcome) => message((outcome as PromiseRejectedResult).reason)).join(" "));
    setLoading(false);
  };

  const refreshChapters = async () => {
    if (!series) return;
    const controller = newRequest(); setLoading(true);
    try {
      const list = await onlineApi.chapters(series.id, true, controller.signal);
      if (!controller.signal.aborted) {
        setChapters(list);
        setScanlatorFilter((selected) => selected === "all" || list.some((item) =>
          (item.scanlator?.trim() ? `name:${item.scanlator.trim()}` : "unknown") === selected) ? selected : "all");
      }
    } catch (cause) { if (!controller.signal.aborted) setError(message(cause)); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  };

  const openChapter = async (item: OnlineChapter) => {
    if (!series || useProjectStore.getState().busy) return;
    newRequest();
    setLoading(true);
    const opened = await importOnlineChapter({ mangaId: series.id, chapterIndex: item.index, chapterId: item.id }, series.title);
    setLoading(false);
    if (opened) { setChapter(item); setView("series"); onClose(); }
  };

  const back = () => {
    newRequest(); setLoading(false);
    setView("browse");
  };
  const ordered = chapterOrder(chapters);
  const scanlators = [...new Set(chapters.map((item) => item.scanlator?.trim()).filter((name): name is string => !!name))]
    .sort((a, b) => a.localeCompare(b));
  const visibleChapters = (oldestFirst ? ordered : [...ordered].reverse()).filter((item) =>
    (scanlatorFilter === "all" || (item.scanlator?.trim() ? `name:${item.scanlator.trim()}` : "unknown") === scanlatorFilter) &&
    `${item.name} ${item.scanlator ?? ""} ${item.chapterNumber}`.toLowerCase().includes(chapterFilter.toLowerCase()));
  const serverKey = connection?.serverUrl ?? "";

  useEffect(() => {
    if (!chapter || !series) { onNavigationChange(null); return; }
    const inOrder = chapterOrder(chapters, chapter.scanlator ?? null);
    const index = inOrder.findIndex((item) => item.id === chapter.id);
    onNavigationChange({ serverUrl: serverKey, mangaId: series.id, chapterId: chapter.id, label: chapter.name,
      previous: index > 0 ? () => { void openChapter(inOrder[index - 1]); } : undefined,
      next: index >= 0 && index < inOrder.length - 1 ? () => { void openChapter(inOrder[index + 1]); } : undefined });
  }, [chapter, chapters, series, serverKey, onNavigationChange]);

  return <section className="online-screen" hidden={hidden} aria-label="Online library">
    <header className="online-header">
      <button className="header-brand" onClick={onClose} disabled={busy} title={project ? "Back to cropper" : "Back to projects"}>
        <img className="header-mark" src="/brand-mark.svg" width={22} height={22} alt="" />
        <div><strong>Panel Cropper</strong><span>Online library</span></div>
      </button>
      <nav className="online-breadcrumbs" aria-label="Online navigation">
        <button className="toolbar-button" onClick={() => { newRequest(); setLoading(false); setView("browse"); }} disabled={busy}>Browse</button>
        {series && view !== "browse" && <><span>/</span><button className="toolbar-button"
          onClick={() => { newRequest(); setLoading(false); setView("series"); }} disabled={busy}>{series.title}</button></>}
      </nav>
      <div className="online-header-actions">
        <button className="toolbar-button" onClick={() => setSettingsOpen((value) => !value)} disabled={busy || connecting}
          aria-expanded={settingsOpen}><Settings2 size={16} /> Connection</button>
        <button className="toolbar-button" onClick={onClose} disabled={busy}><Crop size={16} /> {project ? "Crop workspace" : "Projects"}</button>
      </div>
    </header>

    {settingsOpen && <form className="online-connection" onSubmit={(event) => { event.preventDefault(); void connect(true); }}>
      <label>Reader server<input type="url" value={serverUrl} required placeholder="http://127.0.0.1:4567"
        onChange={(event) => setServerUrl(event.target.value)} disabled={connecting || busy} /></label>
      <label>Username <small>Optional</small><input autoComplete="username" value={username}
        onChange={(event) => setUsername(event.target.value)} disabled={connecting || busy} /></label>
      <label>Password <small>{connection?.hasPassword ? "Saved; leave blank to keep" : "Optional"}</small>
        <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={connecting || busy} /></label>
      <button className="primary-button" disabled={connecting || busy}>{connecting ? <LoaderCircle className="spin" size={16} /> : <Globe size={16} />} Connect</button>
    </form>}
    {(error || storeError) && <div className="online-message error-banner" role="alert">
      <span>{error ?? storeError}</span><button className="toolbar-button" onClick={() => { setError(null); useProjectStore.getState().clearError(); }}>Dismiss</button>
    </div>}
    {notice && <div className="online-message" role="status">{notice}</div>}

    <div className="online-body">
      <div className="online-browse-view" hidden={view !== "browse"}>
        <div className="online-search-panel">
          <div><h1>Find your next chapter</h1><p>Search a source, open a series, then read and crop in one place.</p></div>
          <form className="online-search-form" onSubmit={(event) => { event.preventDefault(); setMode("popular"); void search(1, { query: query.trim(), source, language, mode: "popular", category, genre }); }}>
            <label className="online-search-input"><Search size={19} /><input aria-label="Search series" placeholder="Search series…"
              value={query} onChange={(event) => setQuery(event.target.value)} disabled={connecting || busy} /></label>
            <select className="online-language" aria-label="Source language" value={language} disabled={connecting || busy}
              onChange={(event) => { setLanguage(event.target.value); setSource("all"); setGenre(""); setCategory(""); setMode("popular"); }}>
              <option value="en">English</option><option value="all">All languages</option>
              {[...new Set(sources.map((item) => item.lang))].filter((lang) => lang !== "en").map((lang) =>
                <option key={lang} value={lang}>{lang === "localsourcelang" ? "Local" : lang.toUpperCase()}</option>)}
            </select>
            <select aria-label="Search source" value={source} onChange={(event) => {
              const nextSource = event.target.value;
              const nextMode = mode === "latest" && nextSource !== "library" &&
                sources.find((item) => item.id === nextSource)?.supportsLatest !== false ? "latest" : "popular";
              setSource(nextSource); setGenre(""); setCategory(""); setMode(nextMode);
              void search(1, { query: query.trim(), source: nextSource, language, mode: nextMode, category: "", genre: "" });
            }} disabled={connecting || busy}>
              <option value="all">All {language === "en" ? "English " : ""}sources</option><option value="library">My library</option>
              {sources.filter((item) => language === "all" || item.lang === language).map((item) => <option key={item.id} value={item.id}>{item.displayName || item.name}</option>)}
            </select>
            <button className="primary-button" disabled={connecting || busy || loading || !connection}>
              {loading ? <LoaderCircle className="spin" size={17} /> : <Search size={17} />} {query.trim() ? "Search" : "Browse"}</button>
          </form>
          <div className="online-search-tabs"><div className="online-browse-actions"><button className={`toolbar-button ${source === "library" ? "accent" : ""}`}
            disabled={connecting || loading || busy || !connection} onClick={() => { setSource("library"); setQuery(""); setCategory(""); setGenre(""); setMode("popular"); void search(1, { query: "", source: "library", language, mode: "popular", category: "", genre: "" }); }}>
            <BookOpen size={16} /> My library</button>
            <button className={`toolbar-button ${mode === "latest" ? "accent" : ""}`} aria-pressed={mode === "latest"}
              disabled={connecting || loading || busy || !connection || sources.find((item) => item.id === source)?.supportsLatest === false}
              onClick={() => { const latestSource = source === "library" ? "all" : source;
                setSource(latestSource); setMode("latest"); setQuery(""); setGenre(""); setCategory("");
                void search(1, { query: "", source: latestSource, language, mode: "latest", category: "", genre: "" }); }}>
              <RefreshCw size={16} /> Latest</button></div>
            {searchSpec && <span>{results.length} series{searchSpec.mode === "latest" ? " · Latest" : ""}{searchSpec.genre ? ` · ${searchSpec.genre}` : ""}{searchSpec.query ? ` for “${searchSpec.query}”` : ""}</span>}
          </div>
          {source === "library" && <div className="online-category-tabs" aria-label="Library categories">
            {[{ id: "", name: "All categories" }, ...categories.map((item) => ({ ...item, id: String(item.id) }))].map((item) =>
              <button key={item.id} className={`toolbar-button ${category === item.id ? "accent" : ""}`} aria-pressed={category === item.id}
                disabled={loading || busy || connecting} onClick={() => { setCategory(item.id); setGenre(""); setMode("popular");
                  void search(1, { query: query.trim(), source: "library", language, mode: "popular", category: item.id, genre: "" }); }}>{item.name}</button>)}
          </div>}
          <div className="online-genre-filter"><label>Genre <select aria-label="Filter by genre" value={genre}
            disabled={genreLoading || !genres.length || connecting || busy || loading}
            onChange={(event) => { setGenre(event.target.value); setMode("popular");
              void search(1, { query: query.trim(), source, language, mode: "popular", category, genre: event.target.value }); }}>
            <option value="">{genreLoading ? "Loading genres…" : "All genres"}</option>
            {genres.map((name) => <option key={name} value={name}>{name}</option>)}
          </select></label><span>{genreHints.join(" ")}{mode === "latest" && genres.length > 0 ? " Choosing a genre switches to source search." : ""}</span>
          </div>
        </div>
        <div className="online-results-scroll" ref={browseScroll}>
          {results.length > 0 && <div className="online-series-grid">
            {results.map((item) => <button key={`${serverKey}-${item.id}`} className="online-series-card" onClick={() => void openSeries(item)} disabled={busy}>
              <Cover series={item} serverUrl={serverKey} /><strong>{item.title}</strong>
              <span>{sources.find((entry) => entry.id === item.sourceId)?.displayName ?? item.source?.displayName ?? "Series"}</span>
            </button>)}
          </div>}
          {!results.length && <div className="online-empty">
            {loading || connecting ? <><LoaderCircle className="spin" size={32} /><strong>{connecting ? "Connecting to your sources…" : "Searching…"}</strong></>
              : <><BookOpen size={38} /><strong>{searchSpec ? "No series found" : "Your reader and cropper, together"}</strong>
                <span>{searchSpec ? "Try another title or source." : "Search by title, browse popular series, or open My library."}</span></>}
          </div>}
          {hasMore && <div className="online-load-more"><button className="secondary-button" disabled={loading || busy}
            onClick={() => { if (searchSpec) void search(page + 1, searchSpec); }}>{loading ? "Loading…" : "Load more series"}</button></div>}
        </div>
      </div>

      <div className="online-series-view" hidden={view !== "series"} ref={seriesScroll}>
        {series && <div className="online-series-layout">
          <aside className="online-series-info">
            <button className="toolbar-button" onClick={back} disabled={busy}><ArrowLeft size={16} /> Search results</button>
            <Cover key={`${serverKey}-${series.id}`} series={series} serverUrl={serverKey} />
            <h1>{series.title}</h1>
            <div className="online-series-meta"><span>{series.status?.replaceAll("_", " ").toLowerCase()}</span>
              <span>{series.author && `Author: ${series.author}`}</span><span>{series.artist && `Artist: ${series.artist}`}</span>
              <span>{series.source?.displayName ?? sources.find((item) => item.id === series.sourceId)?.displayName}</span></div>
            {!!series.genre?.length && <div className="online-genres">{series.genre.map((genre) => <span key={genre}>{genre}</span>)}</div>}
            <p className="online-description">{series.description || (loading ? "Loading series details…" : "No description available.")}</p>
          </aside>
          <section className="online-chapters">
            <div className="online-chapter-heading"><h2>Chapters <span>{scanlatorFilter !== "all" || chapterFilter ? `${visibleChapters.length} / ${chapters.length}` : chapters.length}</span></h2>
              <button className="toolbar-button" onClick={() => void refreshChapters()} disabled={loading || busy}><RefreshCw size={15} /> Refresh</button></div>
            <div className="online-chapter-filters"><input aria-label="Filter chapters" placeholder="Find a chapter…"
              value={chapterFilter} onChange={(event) => setChapterFilter(event.target.value)} />
              <select aria-label="Filter by scanlator" value={scanlatorFilter} disabled={loading || busy || !chapters.length}
                onChange={(event) => setScanlatorFilter(event.target.value)}>
                <option value="all">All scanlators</option>
                {scanlators.map((name) => <option key={name} value={`name:${name}`}>{name}</option>)}
                {chapters.some((item) => !item.scanlator?.trim()) && <option value="unknown">Unknown scanlator</option>}
              </select>
              <button className="toolbar-button" onClick={() => setOldestFirst((value) => !value)}>{oldestFirst ? "Oldest first" : "Newest first"}</button></div>
            {loading && !busy && <div className="online-inline-loading"><LoaderCircle className="spin" size={18} /> Loading chapter information…</div>}
            {!loading && !visibleChapters.length && <div className="online-empty"><strong>{chapters.length ? "No matching chapters" : "No chapters available"}</strong>
              <span>{chapters.length ? "Try another chapter name, number, or scanlator." : "Refresh the chapter list to try again."}</span></div>}
            <div className="online-chapter-list">{visibleChapters.map((item) => <button key={item.id} className="online-chapter-row" disabled={loading || busy}
              onClick={() => void openChapter(item)}>
              <BookOpen size={18} /><div><strong>{item.name}</strong><span>{item.scanlator || "Read online"}
                {item.uploadDate > 0 && ` · ${new Date(item.uploadDate).toLocaleDateString()}`}</span></div>
              {item.read && <small>Read</small>}<ArrowRight size={17} />
            </button>)}</div>
          </section>
        </div>}
      </div>

    </div>
    {busy && <div className="online-busy" role="status"><LoaderCircle className="spin" size={18} /> {importFeedback ?? "Preparing chapter…"}</div>}
  </section>;
}
