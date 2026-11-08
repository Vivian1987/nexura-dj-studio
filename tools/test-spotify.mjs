// Pruebas en Node de la importación de listas de Spotify (solo metadatos): node tools/test-spotify.mjs
// Enlaces/URIs, normalización, emparejamiento con la biblioteca local (casos difíciles), JSON de la
// página de inserción (fixture en tools/fixtures), respuestas de la Web API, YouTube y enlaces de compra.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const S = await import('../src/js/spotify/spotify-core.js');
const fixture = readFileSync(join(here, 'fixtures', 'spotify-embed-playlist.html'), 'utf8');
const local = JSON.parse(readFileSync(join(here, 'fixtures', 'spotify-local-library.json'), 'utf8'));

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('✓', name); };

// ------------------------------------------------------------------ enlaces
test('Enlaces: open.spotify.com con /intl-es/, ?si= y /embed/', () => {
  const id = '37i9dQZF1DXcBWIGoYBM5M';
  for (const u of [
    `https://open.spotify.com/playlist/${id}`,
    `https://open.spotify.com/playlist/${id}?si=a1b2c3d4e5f6`,
    `https://open.spotify.com/intl-es/playlist/${id}?si=xyz&nd=1`,
    `https://open.spotify.com/intl-pt-BR/playlist/${id}`,
    `open.spotify.com/playlist/${id}`,
    `https://open.spotify.com/embed/playlist/${id}?utm_source=generator`,
    `https://open.spotify.com/user/spotify/playlist/${id}`,
    `http://play.spotify.com/playlist/${id}`,
    `  https://open.spotify.com/playlist/${id}/  `
  ]) assert.deepEqual(S.parseSpotifyInput(u), { type: 'playlist', id }, u);
  assert.deepEqual(S.parseSpotifyInput('https://open.spotify.com/album/1ATL5GLyefJaxhQzSPVrLX?si=1'), { type: 'album', id: '1ATL5GLyefJaxhQzSPVrLX' });
  assert.deepEqual(S.parseSpotifyInput('https://open.spotify.com/intl-es/track/5ghIJDpPoe3CfHMGu71E6T'), { type: 'track', id: '5ghIJDpPoe3CfHMGu71E6T' });
});
test('Enlaces: URIs spotify:playlist:… (también la antigua spotify:user:…:playlist:…)', () => {
  assert.deepEqual(S.parseSpotifyInput('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M'), { type: 'playlist', id: '37i9dQZF1DXcBWIGoYBM5M' });
  assert.deepEqual(S.parseSpotifyInput('spotify:user:pepe:playlist:37i9dQZF1DXcBWIGoYBM5M'), { type: 'playlist', id: '37i9dQZF1DXcBWIGoYBM5M' });
  assert.deepEqual(S.parseSpotifyInput('SPOTIFY:ALBUM:1ATL5GLyefJaxhQzSPVrLX'), { type: 'album', id: '1ATL5GLyefJaxhQzSPVrLX' });
});
test('Enlaces: lo que no es una lista, álbum o canción de Spotify se rechaza', () => {
  for (const u of ['', 'hola', 'https://www.youtube.com/playlist?list=PL123', 'https://open.spotify.com/artist/0TnOYISbd1XYRBk9myaseg',
    'https://open.spotify.com/playlist/corto', 'https://spotify.link/abcDEF', 'https://evil.com/open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
    'https://open.spotify.com.evil.com/playlist/37i9dQZF1DXcBWIGoYBM5M', 'spotify:episode:37i9dQZF1DXcBWIGoYBM5M', 'javascript:alert(1)'])
    assert.equal(S.parseSpotifyInput(u), null, u);
});

// ------------------------------------------------------------------ normalización
test('Normalización: acentos, signos, «&», «$» y espacios', () => {
  assert.equal(S.fold('Tiësto'), 'tiesto');
  assert.equal(S.fold('ROSALÍA'), 'rosalia');
  assert.equal(S.fold('Beyoncé & JAY-Z'), 'beyonce and jay z');
  assert.equal(S.fold("Don't Stop Me Now"), 'dont stop me now');
  assert.equal(S.fold('A$AP Rocky'), 'asap rocky');
  assert.equal(S.fold('Sigur Rós · Hoppípolla'), 'sigur ros hoppipolla');
  assert.equal(S.fold('Mø'), 'mo');
});
test('Títulos: quita feat., «Original Mix», «- Remastered», ediciones y detecta remixes', () => {
  const t = (s) => { const p = S.parseTitle(s); return [p.base, p.kind, p.version]; };
  assert.deepEqual(t('Levels (Original Mix)'), ['levels', 'original', '']);
  assert.deepEqual(t('Levels - Radio Edit'), ['levels', 'edit', '']);
  assert.deepEqual(t("Don't Stop Me Now - Remastered 2011"), ['dont stop me now', 'original', '']);
  assert.deepEqual(t('Yesterday - 2009 Remaster'), ['yesterday', 'original', '']);
  assert.deepEqual(t('Titanium (feat. Sia)'), ['titanium', 'original', '']);
  assert.deepEqual(t('One Kiss (with Dua Lipa)'), ['one kiss', 'original', '']);
  assert.deepEqual(t('Cola - Robin Schulz Remix'), ['cola', 'version', 'robin schulz remix']);
  assert.deepEqual(t('Cola [Robin Schulz Remix]'), ['cola', 'version', 'robin schulz remix']);
  assert.deepEqual(t('Losing It (Extended Mix)'), ['losing it', 'edit', '']);
  assert.deepEqual(t('One More Time (Live)'), ['one more time', 'version', 'live']);
  assert.deepEqual(t('Malamente (Cap.1 Augurio)'), ['malamente cap 1 augurio', 'original', '']);
  assert.deepEqual(t('MALAMENTE - Cap.1: Augurio'), ['malamente cap 1 augurio', 'original', '']);
  assert.deepEqual(t('Something feat. Someone Else'), ['something', 'original', '']);
  assert.deepEqual(S.parseTitle('Titanium (feat. Sia)').feat, ['sia']);
});
test('Artistas: separadores, invitados y «The»', () => {
  assert.deepEqual(S.splitArtists('Calvin Harris & Dua Lipa'), ['calvin harris', 'dua lipa']);
  assert.deepEqual(S.splitArtists('David Guetta feat. Sia'), ['david guetta', 'sia']);
  assert.deepEqual(S.splitArtists(['The Weeknd', 'Daft Punk']), ['weeknd', 'daft punk']);
  assert.deepEqual(S.splitArtists('Kungs vs. Cookin\' On 3 Burners'), ['kungs', 'cookin on 3 burners']);
  assert.deepEqual(S.splitArtists('A, B; C / D x E'), ['a', 'b', 'c', 'd', 'e']);
});
test('Similitud: Jaro-Winkler y Dice de palabras', () => {
  assert.ok(Math.abs(S.jaroWinkler('martha', 'marhta') - 0.961) < 0.001);
  assert.equal(S.jaroWinkler('abc', 'abc'), 1);
  assert.equal(S.jaroWinkler('', 'abc'), 0);
  assert.equal(S.tokenDice('one more time', 'time more one'), 1);
  assert.equal(S.normIsrc('gb-um7-10-29604'), 'GBUM71029604');
  assert.equal(S.normIsrc('no vale'), '');
});

// ------------------------------------------------------------------ JSON de la página de inserción
const list = S.parseEmbedHtml(fixture, { type: 'playlist', id: '5NxFixturePlaylist0001' });
test('Página de inserción: nombre, carátula, pistas, artistas y duraciones del fixture', () => {
  assert.equal(list.type, 'playlist');
  assert.equal(list.id, '5NxFixturePlaylist0001');
  assert.equal(list.name, 'Nexura · Prueba DJ');
  assert.equal(list.owner, 'NexuraIA');
  assert.equal(list.cover, 'https://image-cdn-ak.spotifycdn.com/image/ab67706c0000da84fixture300'); // la menor ≥ 200 px
  assert.equal(list.tracks.length, 16);
  assert.equal(list.truncated, false);
  assert.deepEqual(list.tracks[1], { uri: 'spotify:track:3NxTest000000000000002', id: '3NxTest000000000000002', title: 'One Kiss (with Dua Lipa)', artists: ['Calvin Harris', 'Dua Lipa'], duration: 214.846, explicit: false, cover: '' });
  assert.deepEqual(list.tracks[10].artists, ['CamelPhat', 'Elderbrook', 'Robin Schulz']);
  // solo metadatos: la URL de la vista previa de audio no se copia
  assert.ok(!JSON.stringify(list).includes('mp3-preview'));
});
test('Página de inserción: 100 pistas = posiblemente truncada; versión antigua en base64; canción; no encontrada', () => {
  const big = fixture.replace(/"trackList":\[[\s\S]*?\],"visualIdentity"/, '"trackList":' + JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ uri: 'spotify:track:' + String(i).padStart(22, '0'), title: 'T' + i, subtitle: 'A', duration: 1000 }))) + ',"visualIdentity"');
  assert.equal(S.parseEmbedHtml(big).truncated, true);
  const entity = { type: 'album', name: 'Discovery', subtitle: 'Daft Punk', tracks: { total: 14, items: [{ track: { type: 'track', name: 'One More Time', artists: [{ name: 'Daft Punk' }], duration_ms: 320357, uri: 'spotify:track:0DiWol3AO6WpXZgp0goxAV', external_ids: { isrc: 'GBDUW0000059' } } }] } };
  const old = `<html><script id="resource" type="application/json">${Buffer.from(JSON.stringify(entity), 'utf8').toString('base64')}</script></html>`;
  const a = S.parseEmbedHtml(old);
  assert.deepEqual([a.type, a.name, a.tracks[0].title, a.tracks[0].isrc, a.truncated], ['album', 'Discovery', 'One More Time', 'GBDUW0000059', true]);
  const track = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { state: { data: { entity: { type: 'track', name: 'Losing It', uri: 'spotify:track:6ho0GyrWZN3mhi9zVRW7xi', artists: [{ name: 'FISHER' }], duration: 248000 } } } } } })}</script>`;
  const t = S.parseEmbedHtml(track);
  assert.deepEqual([t.type, t.tracks.length, t.tracks[0].artists[0], t.tracks[0].duration, t.truncated], ['track', 1, 'FISHER', 248, false]);
  assert.throws(() => S.parseEmbedHtml(`<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"status":404}}}</script>`), /no existe/);
  assert.throws(() => S.parseEmbedHtml('<html>nada</html>'), /No se encontraron/);
});
test('Web API: pistas de lista (item/track), episodios fuera, ISRC y carátula', () => {
  const page = { items: [
    { item: { type: 'track', name: 'Levels', artists: [{ name: 'Avicii' }], duration_ms: 199906, uri: 'spotify:track:5UqCQaDshqbIk3pkhy4Pjg', id: '5UqCQaDshqbIk3pkhy4Pjg', external_ids: { isrc: 'SE3HN1100204' }, album: { name: 'Levels', images: [{ url: 'big', width: 640 }, { url: 'mid', width: 300 }, { url: 'small', width: 64 }] } } },
    { track: { type: 'episode', name: 'Podcast' } },
    { track: null },
    { track: { type: 'track', name: 'Animals', artists: [{ name: 'Martin Garrix' }], duration_ms: 304615, uri: 'spotify:track:x' } }
  ] };
  const ts = S.mapPlaylistPage(page);
  assert.equal(ts.length, 2);
  assert.deepEqual([ts[0].title, ts[0].isrc, ts[0].duration, ts[0].cover, ts[0].album], ['Levels', 'SE3HN1100204', 199.906, 'mid', 'Levels']);
});

// ------------------------------------------------------------------ emparejamiento
const items = S.matchList(list.tracks, local);
const by = (title) => items.find(i => i.title === title);
const expect = (title, id, conf) => {
  const it = by(title);
  assert.equal(it.cands[0] ? it.cands[0].id : null, id, `${title}: candidato ${JSON.stringify(it.cands)}`);
  assert.equal(it.conf, conf, `${title}: confianza ${it.score}`);
  assert.equal(it.local, conf === 'high' ? id : null, title);
};
test('Emparejamiento: radio edit ↔ original mix, y no el remix de otro', () => { expect('Levels - Radio Edit', 'l1', 'high'); });
test('Emparejamiento: «(with …)» y «feat.» en el título o en el artista', () => { expect('One Kiss (with Dua Lipa)', 'l3', 'high'); expect('Titanium (feat. Sia)', 'l6', 'high'); });
test('Emparejamiento: «The Weeknd» = «Weeknd»; acentos y mayúsculas (ROSALÍA, Tití Me Preguntó)', () => {
  expect('Blinding Lights', 'l4', 'high'); expect('MALAMENTE - Cap.1: Augurio', 'l5', 'high'); expect('Tití Me Preguntó', 'l13', 'high');
});
test('Emparejamiento: radio edit ↔ extended mix (otra duración) se acepta', () => { expect("Don't You Worry Child - Radio Edit", 'l7', 'high'); });
test('Emparejamiento: original frente a directo del mismo tema', () => {
  expect('One More Time', 'l8', 'high');
  assert.ok(!by('One More Time').cands.some(c => c.id === 'l9' && c.score >= S.MATCH_REVIEW));
});
test('Emparejamiento: «- Remastered 2011»', () => { expect("Don't Stop Me Now - Remastered 2011", 'l10', 'high'); });
test('Emparejamiento: pista local sin artista (lo saca del nombre del archivo) y no el remix', () => { expect('Animals - Original Mix', 'l11', 'high'); });
test('Emparejamiento: remix ↔ el mismo remix (no el original)', () => { expect('Cola - Robin Schulz Remix', 'l15', 'high'); });
test('Emparejamiento: «Sophie and the Giants» ↔ «Sophie And The Giants»; FISHER ↔ Fisher', () => { expect('In The Dark', 'l16', 'high'); expect('Losing It', 'l17', 'high'); });
test('Emparejamiento: mismo título de otro artista y duración distinta → sin coincidencia', () => { expect('Intro', null, 'none'); });
test('Emparejamiento: errata y duración +14 s → «revisar» (no se acepta sola); el remix no cuenta', () => {
  expect('Sweet Disposition', 'l19', 'review');
  assert.ok(!by('Sweet Disposition').cands.some(c => c.id === 'l20'));
});
test('Emparejamiento: canción que no está → sin coincidencia', () => { expect('Cancion Inédita Que No Tengo', null, 'none'); });
test('Emparejamiento: el ISRC manda aunque el título no coincida', () => {
  const [it] = S.matchList([{ uri: 'spotify:track:q', title: 'Título en otro idioma', artists: ['Otro'], isrc: 'GBUM71029604', duration: 100 }], local);
  assert.deepEqual([it.local, it.score, it.cands[0].isrc], ['l10', 1, true]);
});
test('Emparejamiento: duración ±5 s sin penalización, más lejos baja la confianza', () => {
  const a = S.prepTrack({ title: 'Losing It', artists: ['Fisher'], duration: 248 });
  const near = S.scorePair(a, S.prepTrack({ title: 'Losing It', artist: 'Fisher', duration: 252 })).score;
  const far = S.scorePair(a, S.prepTrack({ title: 'Losing It', artist: 'Fisher', duration: 290 })).score;
  assert.equal(near, 1);
  assert.ok(far < S.MATCH_HIGH, String(far));
});
test('Emparejamiento: se respetan las decisiones de una importación anterior', () => {
  const k = (t) => by(t).key;
  const prior = [
    { key: k('One More Time'), manual: true, local: null },                 // el usuario dijo «no la tengo»
    { key: k('Cancion Inédita Que No Tengo'), manual: true, local: 'l18' }, // la emparejó a mano
    { key: k('Intro'), yt: { videoId: 'abcdefghijk', title: 'The xx - Intro' } }
  ];
  const again = S.matchList(list.tracks, local, prior);
  const g = (t) => again.find(i => i.title === t);
  assert.equal(g('One More Time').local, null);
  assert.equal(g('Cancion Inédita Que No Tengo').local, 'l18');
  assert.equal(g('Intro').yt.videoId, 'abcdefghijk');
  // una pista que ya no existe en la biblioteca no se mantiene
  const gone = S.matchList(list.tracks, local.filter(t => t.id !== 'l18'), prior);
  assert.equal(gone.find(i => i.title === 'Cancion Inédita Que No Tengo').local, null);
});
test('Crate: orden original, sin duplicados, local antes que YouTube', () => {
  const its = [{ local: 'l3' }, { local: null, yt: { videoId: 'abc-DEF_123' } }, { local: null }, { local: 'l1', yt: { videoId: 'zzz' } }, { local: 'l3' }];
  assert.deepEqual(S.crateIdsFrom(its), ['l3', 'yt_abc-DEF_123', 'l1']);
  assert.deepEqual(its.map(S.itemStatus), ['local', 'youtube', 'missing', 'local', 'local']);
});
test('Rendimiento: 1000 pistas de Spotify contra 5000 locales en menos de 3 s', () => {
  const words = ['love', 'night', 'fire', 'dance', 'heart', 'light', 'summer', 'dream', 'party', 'sky', 'gold', 'rain', 'city', 'run', 'wild', 'blue'];
  const rnd = (i, k) => words[(i * 7 + k * 13) % words.length] + ' ' + words[(i * 3 + k * 5 + 1) % words.length] + ' ' + i;
  const big = Array.from({ length: 5000 }, (_, i) => ({ id: 'b' + i, artist: 'Artista ' + (i % 300), title: rnd(i, 1), duration: 180 + (i % 120) }));
  const sp = Array.from({ length: 1000 }, (_, i) => ({ uri: 'u' + i, title: rnd(i * 5, 1), artists: ['Artista ' + ((i * 5) % 300)], duration: 180 + ((i * 5) % 120) }));
  const t0 = Date.now();
  const r = S.matchList(sp, big);
  const ms = Date.now() - t0;
  assert.ok(ms < 3000, ms + ' ms');
  assert.equal(r.filter(x => x.local).length, 1000);
  console.log(`   (${ms} ms)`);
});

// ------------------------------------------------------------------ YouTube y tiendas
test('YouTube: consulta con artista y título sin «feat.» ni «Remastered»', () => {
  assert.equal(S.youtubeQuery({ title: 'Titanium (feat. Sia)', artists: ['David Guetta', 'Sia'] }), 'David Guetta Titanium');
  assert.equal(S.youtubeQuery({ title: "Don't Stop Me Now - Remastered 2011", artists: ['Queen'] }), "Queen Don't Stop Me Now");
  assert.equal(S.youtubeQuery({ title: 'Cola - Robin Schulz Remix', artists: ['CamelPhat'] }), 'CamelPhat Cola - Robin Schulz Remix');
});
test('YouTube: elige el oficial y evita directo, karaoke, cover y remix salvo que el título lo pida', () => {
  const res = [
    { videoId: 'live0000001', title: 'Avicii - Levels (Live at Ultra Music Festival)', channel: 'Ultra', duration: 420 },
    { videoId: 'karaoke0001', title: 'Avicii - Levels (Karaoke Version)', channel: 'Karaoke Hits', duration: 200 },
    { videoId: 'cover000001', title: 'Levels - Avicii (Piano Cover)', channel: 'Pianista', duration: 190 },
    { videoId: 'remix000001', title: 'Avicii - Levels (Skrillex Remix)', channel: 'Avicii', duration: 330 },
    { videoId: 'official001', title: 'Avicii - Levels', channel: 'AviciiOfficialVEVO', duration: 202 },
    { videoId: 'otro0000001', title: 'Top 10 EDM 2012', channel: 'Listas', duration: 3600 }
  ];
  assert.equal(S.pickYouTubeResult({ title: 'Levels - Radio Edit', artists: ['Avicii'], duration: 200 }, res).item.videoId, 'official001');
  assert.equal(S.pickYouTubeResult({ title: 'Levels - Live at Ultra Music Festival', artists: ['Avicii'], duration: 420 }, res).item.videoId, 'live0000001');
  assert.equal(S.pickYouTubeResult({ title: 'Levels - Skrillex Remix', artists: ['Avicii'], duration: 330 }, res).item.videoId, 'remix000001');
  assert.equal(S.pickYouTubeResult({ title: 'Otra Canción', artists: ['Nadie'], duration: 200 }, res), null);
  assert.equal(S.pickYouTubeResult({ title: 'X', artists: ['Y'] }, []), null);
});
test('Comprar: búsquedas https en Beatport, Bandcamp e iTunes con artista y título', () => {
  const l = S.buyLinks({ title: 'Titanium (feat. Sia)', artists: ['David Guetta', 'Sia'] });
  assert.deepEqual(l.map(x => x.label), ['Beatport', 'Bandcamp', 'iTunes']);
  assert.equal(l[0].url, 'https://www.beatport.com/search?q=David%20Guetta%20Titanium');
  assert.ok(l.every(x => /^https:\/\/(www\.beatport\.com|bandcamp\.com|music\.apple\.com)\//.test(x.url)));
  assert.equal(S.buyLinks({ title: 'A&B', artists: ['C/D'] })[1].url, 'https://bandcamp.com/search?q=C%2FD%20A%26B&item_type=t');
});
test('Redirect URI fijo en 127.0.0.1 (Spotify no admite «localhost»)', () => {
  assert.equal(S.SPOTIFY_REDIRECT_URI, 'http://127.0.0.1:43827/callback');
  const main = readFileSync(join(here, '..', 'main.js'), 'utf8');
  assert.ok(main.includes('const SPOTIFY_PORT = 43827;'), 'main.js usa el mismo puerto');
  assert.ok(!/yt-dlp|ytdl|youtube-dl/i.test(main), 'sin descargadores de audio');
});

console.log(`\n${n} pruebas correctas`);
