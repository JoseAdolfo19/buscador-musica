"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  fetchLyrics,
  searchSongs,
  searchYoutubeVideo,
  type LyricLine,
  type SearchResult,
} from "@/lib/music";

const YOUTUBE_API_KEY =
  (typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_YOUTUBE_API_KEY) ||
  "";

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: (() => void) | undefined;
  }
}

function formatDuration(ms: number): string {
  if (!ms) return "";
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = String(totalSec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function previewDurationLabel(ms: number): string {
  return ms ? `Preview ${formatDuration(ms)}` : "Preview";
}

export default function Home() {
  // Estado de la búsqueda
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  // Estado del reproductor
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [lyricsSynced, setLyricsSynced] = useState(false);
  const [lyricsSource, setLyricsSource] = useState("");
  const [currentLine, setCurrentLine] = useState(-1);
  const [status, setStatus] = useState("");

  // Video: videoId si logramos cargar YouTube, de lo contrario portada + audio
  const [videoId, setVideoId] = useState<string | null>(null);
  const [usingVideo, setUsingVideo] = useState(false);

  // Refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playerRef = useRef<any>(null);
  const playerReadyRef = useRef(false);
  const lyricsBoxRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const activeModeRef = useRef<"audio" | "video">("audio");

  // -------------------------------------------------------------------------
  // YouTube IFrame API: se carga una única vez
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!window.YT) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
      window.onYouTubeIframeAPIReady = () => {
        setStatus("");
      };
    }
  }, []);

  // -------------------------------------------------------------------------
  // Búsqueda
  // -------------------------------------------------------------------------
  const handleSearch = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setSearchError("");
    try {
      const res = await searchSongs(query);
      setResults(res);
      if (res.length === 0) setSearchError("No se encontraron resultados.");
    } catch {
      setSearchError("Error al buscar. Revisa tu conexión.");
    } finally {
      setSearching(false);
    }
  }, [query]);

  // -------------------------------------------------------------------------
  // Selección de una canción: carga letra y video/audio
  // -------------------------------------------------------------------------
  const selectSong = async (r: SearchResult) => {
    // limpiar estado previo
    if (playerRef.current) {
      try {
        playerRef.current.destroy();
      } catch {}
      playerRef.current = null;
    }
    playerReadyRef.current = false;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
    setSelected(r);
    setLyrics([]);
    setLyricsSynced(false);
    setLyricsSource("");
    setCurrentLine(-1);
    setVideoId(null);
    setUsingVideo(false);
    setStatus("Buscando letra y audio completo...");

    // 1) Letra (+ YouTube ID de letras.com cuando está disponible)
    let youtubeIdFromLyrics: string | null = null;
    try {
      const res = await fetchLyrics(r.artist, r.track);
      setLyrics(res.lines);
      setLyricsSynced(res.synced);
      setLyricsSource(res.source);
      youtubeIdFromLyrics = res.youtubeId;
    } catch {
      setLyrics([]);
    }

    // 2) Reproductor con la canción COMPLETA.
    //    Prioridad: YouTube ID de letras.com -> búsqueda en YouTube (API key).
    //    El video de YouTube reproduce la canción entera, no solo 30 seg.
    let vid: string | null = youtubeIdFromLyrics;
    if (!vid) {
      const key = YOUTUBE_API_KEY.trim();
      if (key) {
        vid = await searchYoutubeVideo(`${r.artist} ${r.track}`, key);
      }
    }
    if (vid) {
      setVideoId(vid);
      setUsingVideo(true);
      setStatus("");
      loadYoutubeVideo(vid);
      return; // el video manda el tiempo
    }

    // 3) Sin video -> portada + preview de iTunes (solo 30 segundos)
    setUsingVideo(false);
    activeModeRef.current = "audio";
    setStatus("Audio de muestra (30 s). Sin video completo disponible.");
    if (r.previewUrl && audioRef.current) {
      audioRef.current.src = r.previewUrl;
      audioRef.current.play().catch(() => {});
    }
  };

  // Carga un video en el reproductor de YouTube embebido.
  const loadYoutubeVideo = useCallback((vid: string) => {
    const container = document.getElementById("youtube-player");
    if (!container) return;

    const createPlayer = () => {
      if (!window.YT?.Player) return;
      try {
        playerRef.current = new window.YT.Player("youtube-player", {
          videoId: vid,
          playerVars: { playsinline: 1 },
          events: {
            onReady: (ev: any) => {
              playerReadyRef.current = true;
              activeModeRef.current = "video";
              ev.target.playVideo();
            },
          },
        });
      } catch {
        /* si falla, no pasa nada */
      }
    };

    if (window.YT?.Player) createPlayer();
    else window.onYouTubeIframeAPIReady = createPlayer;
  }, []);

  // -------------------------------------------------------------------------
  // Sincronización de letras con el tiempo actual
  // -------------------------------------------------------------------------
  const updateCurrentLine = useCallback(
    (t: number) => {
      if (!lyricsSynced || lyrics.length === 0) return;
      let idx = -1;
      for (let i = 0; i < lyrics.length; i++) {
        if (t >= lyrics[i].time) idx = i;
        else break;
      }
      setCurrentLine((prev) => (prev === idx ? prev : idx));
    },
    [lyrics, lyricsSynced]
  );

  // Audio (modo sin video): el elemento <audio> manda el tiempo.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => updateCurrentLine(a.currentTime);
    const onPlay = () => {
      activeModeRef.current = "audio";
    };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("play", onPlay);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("play", onPlay);
    };
  }, [updateCurrentLine]);

  // Video: sondeo de getCurrentTime mientras esté activo el modo video.
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (usingVideo) {
      interval = setInterval(() => {
        if (activeModeRef.current === "video" && playerRef.current) {
          try {
            updateCurrentLine(playerRef.current.getCurrentTime());
          } catch {}
        }
      }, 250);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [usingVideo, updateCurrentLine]);

  // Centrar la línea activa en el panel de letras.
  useEffect(() => {
    if (currentLine < 0) return;
    const el = lineRefs.current[currentLine];
    const box = lyricsBoxRef.current;
    if (el && box) {
      const target = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2;
      box.scrollTo({ top: target, behavior: "smooth" });
    }
  }, [currentLine]);

  const showResults = results.length > 0 && !selected;

  const goBack = useCallback(() => {
    if (playerRef.current) {
      try {
        playerRef.current.destroy();
      } catch {}
      playerRef.current = null;
    }
    playerReadyRef.current = false;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
    setSelected(null);
    setLyrics([]);
    setVideoId(null);
    setUsingVideo(false);
    setStatus("");
  }, []);

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="brand-icon">♪</span>
          <h1>Busca Música</h1>
        </div>
        <form className="searchbar" onSubmit={handleSearch}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Busca una canción o artista…"
          />
          <button type="submit" disabled={searching}>
            {searching ? "Buscando…" : "Buscar"}
          </button>
        </form>
      </header>

      {searchError && <p className="error">{searchError}</p>}

      {/* Resultados de búsqueda */}
      {showResults && (
        <section>
          <div className="results-head">
            <h2>Resultados</h2>
            <span className="count">{results.length} canciones</span>
          </div>
          <div className="results">
            {results.map((r) => (
              <button
                key={r.trackId}
                className="result-card"
                onClick={() => selectSong(r)}
              >
                <div className="art-wrap">
                  {r.artwork ? (
                    <img src={r.artwork} alt="" loading="lazy" />
                  ) : (
                    <div className="no-cover">♪</div>
                  )}
                  <span className="play-hint">▶</span>
                  {r.previewUrl && (
                    <span className="preview-tag">
                      {previewDurationLabel(r.durationMs)}
                    </span>
                  )}
                </div>
                <div className="result-info">
                  <strong>{r.track}</strong>
                  <span className="artist">{r.artist}</span>
                  <span className="album muted">{r.album || "—"}</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Reproductor */}
      {selected && (
        <main className="player">
          <div className="stage">
            <div className="player-top">
              <button className="back-btn" onClick={goBack}>
                ← Volver
              </button>
              {usingVideo && (
                <span className="badge full">
                  ▶ Canción completa · YouTube
                </span>
              )}
            </div>

            {usingVideo ? (
              <>
                <div id="youtube-player" className="video-frame" />
                <span className="badge">Video · YouTube</span>
              </>
            ) : (
              <>
                <div className="cover">
                  {selected.artwork ? (
                    <img src={selected.artwork} alt={selected.track} />
                  ) : (
                    <div className="no-cover">♪</div>
                  )}
                </div>
                <span className="badge">Audio de muestra · 30 s</span>
              </>
            )}

            <div className="track-info">
              <h2>{selected.track}</h2>
              <p>
                {selected.artist}
                {selected.album ? ` · ${selected.album}` : ""}
              </p>
            </div>

            {/* Audio invisible de iTunes (se usa cuando no hay video) */}
            {!usingVideo && (
              <audio ref={audioRef} controls className="audio-controls" />
            )}
          </div>

          <aside className="lyrics-panel">
            <div className="lyrics-head">
              <h3>Letra</h3>
              {lyricsSource && <span className="source">{lyricsSource}</span>}
              {status && <span className="status">{status}</span>}
              {!lyricsSynced && lyrics.length > 0 && (
                <span className="status warn">Letra no sincronizada</span>
              )}
            </div>
            <div className="lyrics-box" ref={lyricsBoxRef}>
              {lyrics.length === 0 ? (
                <p className="no-lyrics">
                  No se encontraron letras para esta canción.
                </p>
              ) : (
                lyrics.map((l, i) => (
                  <div
                    key={i}
                    ref={(el) => {
                      lineRefs.current[i] = el;
                    }}
                    className={
                      "lyric-line" + (i === currentLine ? " active" : "")
                    }
                  >
                    {l.text}
                  </div>
                ))
              )}
            </div>
          </aside>
        </main>
      )}

      {!selected && !showResults && (
        <div className="empty">
          <div className="empty-icon">♪</div>
          <p>Busca una canción. Elige un resultado para ver su video o
          portada con la letra sincronizada al costado.</p>
        </div>
      )}
    </div>
  );
}