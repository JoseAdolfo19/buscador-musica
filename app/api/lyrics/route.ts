// Ruta de servidor: busca letra y el YouTube ID de una canción en letras.com.
// Se ejecuta en el servidor porque letras.com no permite CORS desde el navegador.
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0 Safari/537.36";

// Convierte "Café Tacvba" -> "cafe-tacvba", "feat. X" se elimina, etc.
function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita acentos
    .replace(/feat\.?|ft\.?|\(.*?\)|\[.*?\]/g, " ") // quita colaboraciones/parentesis
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Devuelve las líneas de la letra desde el bloque <div class="lyric-original">.
function extractLyrics(html: string): string[] {
  const block = html.match(/<div class="lyric-original[^"]*">([\s\S]*?)<\/div>/);
  if (!block) return [];
  const paras = block[1].match(/<p>([\s\S]*?)<\/p>/g) || [];
  const lines: string[] = [];
  for (const p of paras) {
    const text = p
      .replace(/<br\s*\/?>/gi, "\n") // <br> se convierte en salto de línea
      .replace(/<[^>]+>/g, "") // quita el resto de etiquetas
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ");
    // Separa por saltos de línea (las estrofas del <p>) y descarta vacíos
    for (const raw of text.split("\n")) {
      const clean = raw.replace(/\s+/g, " ").trim();
      if (clean) lines.push(clean);
    }
  }
  return lines;
}

// Extrae el YouTube ID que letras.com embebe en la página.
function extractYoutubeId(html: string): string | null {
  const m = html.match(/"YoutubeID":"([A-Za-z0-9_-]{6,})"/);
  return m ? m[1] : null;
}

async function fetchSong(artist: string, track: string) {
  const url = `https://www.letras.com/${slugify(artist)}/${slugify(track)}/`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "es" },
    redirect: "follow",
  });
  if (!res.ok) return null;
  const html = await res.text();
  const lyrics = extractLyrics(html);
  if (lyrics.length === 0) return null;
  return { lyrics, youtubeId: extractYoutubeId(html), url };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const artist = searchParams.get("artist") || "";
  const track = searchParams.get("track") || "";

  if (!artist.trim() || !track.trim()) {
    return Response.json(
      { error: "Faltan artist o track" },
      { status: 400 }
    );
  }

  try {
    const data = await fetchSong(artist, track);
    if (!data) {
      return Response.json({ lyrics: [], synced: false, youtubeId: null });
    }
    return Response.json({
      lyrics: data.lyrics,
      synced: false,
      source: "letras.com",
      youtubeId: data.youtubeId,
      url: data.url,
    });
  } catch {
    return Response.json({ lyrics: [], synced: false, youtubeId: null });
  }
}