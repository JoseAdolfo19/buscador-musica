// Lógica de búsqueda de música, letras y video.
// Todos estos endpoints funcionan desde el navegador (CORS habilitado) y no
// requieren autenticación, salvo el de YouTube que usa una API Key opcional.

export interface SearchResult {
  trackId: number;
  artist: string;
  track: string;
  album: string;
  artwork: string; // portada del disco
  previewUrl: string; // audio de prueba de iTunes
  durationMs: number;
}

export interface LyricLine {
  time: number; // segundos; -1 si no hay timestamps
  text: string;
}

// ---------------------------------------------------------------------------
// Búsqueda de canciones con iTunes Search API (gratis, sin API key)
// ---------------------------------------------------------------------------
export async function searchSongs(query: string): Promise<SearchResult[]> {
  if (!query.trim()) return [];
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
    query
  )}&media=music&limit=12`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("No se pudo buscar en iTunes");
  const data = await res.json();
  return (data.results || []).map((r: any) => ({
    trackId: r.trackId,
    artist: r.artistName,
    track: r.trackName,
    album: r.collectionName || "",
    artwork: r.artworkUrl100
      ? r.artworkUrl100.replace("100x100", "600x600")
      : "",
    previewUrl: r.previewUrl || "",
    durationMs: r.trackTimeMillis || 0,
  }));
}

export interface LyricsResult {
  lines: LyricLine[];
  synced: boolean;
  source: string;
  youtubeId: string | null;
}

// ---------------------------------------------------------------------------
// Letras. Orden de fuentes:
//   1) LRCLIB        -> letras SINCORONIZADAS (con timestamps).
//   2) letras.com    -> letra plana + YouTube ID para reproducir la canción
//                       COMPLETA (se consulta a través de una ruta de servidor,
//                       porque letras.com no permite CORS en el navegador).
//   3) Lyrics.ovh    -> letra plana de respaldo (sin sincronía).
// ---------------------------------------------------------------------------
export async function fetchLyrics(
  artist: string,
  track: string
): Promise<LyricsResult> {
  // 1) LRCLIB -> letras sincronizadas
  try {
    const q = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(
      artist
    )}&track_name=${encodeURIComponent(track)}`;
    const res = await fetch(q);
    if (res.ok) {
      const data = await res.json();
      if (data.syncedLyrics) {
        const lines = parseLrc(data.syncedLyrics);
        if (lines.length > 0) {
          return { lines, synced: true, source: "LRCLIB", youtubeId: null };
        }
      }
    }
  } catch {
    /* ignorar y probar la siguiente fuente */
  }

  // 2) letras.com -> letra + YouTube ID (canción completa)
  try {
    const url = `/api/lyrics?artist=${encodeURIComponent(
      artist
    )}&track=${encodeURIComponent(track)}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const lines = (data.lyrics || []).map((text: string) => ({
        time: -1,
        text,
      }));
      if (lines.length > 0) {
        return {
          lines,
          synced: false,
          source: "letras.com",
          youtubeId: data.youtubeId || null,
        };
      }
    }
  } catch {
    /* ignorar y probar la siguiente fuente */
  }

  // 3) Lyrics.ovh -> letra plana de respaldo
  try {
    const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(
      artist
    )}/${encodeURIComponent(track)}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const lines = (data.lyrics || "")
        .split("\n")
        .map((l: string) =>
          l
            .replace(/^\[[^\]]*\]\s*/, "")
            .trim()
        )
        .filter((l: string) => l.length > 0)
        .map((text: string) => ({ time: -1, text }));
      if (lines.length > 0) {
        return { lines, synced: false, source: "Lyrics.ovh", youtubeId: null };
      }
    }
  } catch {
    /* sin letra */
  }

  return { lines: [], synced: false, source: "", youtubeId: null };
}

// Convierte el formato LRC "[mm:ss.xx]texto" en líneas con su tiempo.
function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const re = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]\s*(.*)/;
  for (const raw of lrc.split("\n")) {
    const m = raw.match(re);
    if (m) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      let frac = parseInt(m[3] || "0", 10);
      if (m[3] && m[3].length === 2) frac = frac * 10; // centésimas -> ms aprox
      const time = min * 60 + sec + frac / 1000;
      const text = m[4].trim();
      if (text) lines.push({ time, text });
    }
  }
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

// ---------------------------------------------------------------------------
// Búsqueda de video en YouTube. Requiere NEXT_PUBLIC_YOUTUBE_API_KEY.
// ---------------------------------------------------------------------------
export async function searchYoutubeVideo(
  query: string,
  apiKey: string
): Promise<string | null> {
  if (!apiKey) return null;
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=1&q=${encodeURIComponent(
    query
  )}&key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  return data.items?.[0]?.id?.videoId || null;
}