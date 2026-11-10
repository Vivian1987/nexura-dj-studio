// Simulador del reproductor oficial de YouTube (IFrame Player API) para las pruebas de interfaz.
// No carga nada de YouTube: imita lo que importa al deck, incluidas sus pegas reales:
// - getDuration() da 0 hasta que el vídeo «carga» (400 ms después de crearlo o de cueVideoById);
// - getCurrentTime() solo cambia cada 250 ms (el iframe informa por mensajes);
// - tras cueVideoById, getVideoData() sigue dando el vídeo anterior durante 150 ms;
// - estados -1, 1 (reproduciendo), 2 (pausa), 0 (terminado), 5 (preparado) y velocidad de reproducción.
// Duraciones por vídeo en window.__ytMockVideos = { videoId: segundos } (30 s si no está).
// Uso: inyectarlo con executeJavaScript ANTES de cargar el primer vídeo (define window.YT).
(() => {
  window.__ytMockVideos = window.__ytMockVideos || {};
  window.__ytPlayers = [];
  const now = () => performance.now();
  class Player {
    constructor(el, opts) {
      this.ev = (opts && opts.events) || {};
      this.vid = opts.videoId; this.reportedVid = opts.videoId;
      this.t = 0; this.startAt = now(); this.state = -1; this.rate = 1; this.vol = 100; this.reported = 0;
      this.durAt = now() + 400;
      this.seeks = [];
      const box = document.createElement('div');
      box.className = 'yt-mock';
      box.style.cssText = 'width:100%;height:100%;background:#1b0d10;color:#ff8a8a;display:grid;place-items:center;font:600 12px Inter,sans-serif';
      box.textContent = '▶ vídeo simulado ' + this.vid;
      (typeof el === 'string' ? document.getElementById(el) : el).replaceWith(box);
      this.box = box;
      window.__ytPlayers.push(this);
      this.timer = setInterval(() => this.tick(), 250);
      setTimeout(() => { if (this.ev.onReady) this.ev.onReady({ target: this }); this.setState(5); }, 60);
    }
    pos() { return this.state === 1 ? this.t + (now() - this.startAt) / 1000 * this.rate : this.t; }
    dur() { return now() >= this.durAt ? (window.__ytMockVideos[this.vid] ?? 30) : 0; }
    tick() {
      const p = this.pos(), d = this.dur();
      if (this.state === 1 && d && p >= d) { this.t = d; this.reported = d; this.setState(0); return; }
      this.reported = p;
    }
    setState(s) { this.state = s; if (this.ev.onStateChange) this.ev.onStateChange({ data: s, target: this }); }
    playVideo() { if (this.state === 1) return; if (this.state === 0) this.t = 0; this.startAt = now(); this.setState(1); }
    pauseVideo() { if (this.state !== 1) return; this.t = this.pos(); this.setState(2); }
    seekTo(s) { const d = this.dur(); this.t = Math.max(0, d ? Math.min(s, d) : s); this.startAt = now(); this.seeks.push(s); if (this.state === 0) this.setState(2); }
    cueVideoById(id, start = 0) {
      this.vid = id; this.t = start; this.startAt = now(); this.durAt = now() + 400;
      this.box.textContent = '▶ vídeo simulado ' + id;
      setTimeout(() => { this.reportedVid = id; this.reported = start; }, 150);
      this.setState(5);
    }
    getCurrentTime() { return this.reported; }
    getDuration() { return this.reportedVid === this.vid ? this.dur() : (window.__ytMockVideos[this.reportedVid] ?? 30); }
    getVideoData() { return { video_id: this.reportedVid, title: 'Vídeo ' + this.reportedVid }; }
    getPlaybackRate() { return this.rate; }
    setPlaybackRate(r) { this.t = this.pos(); this.startAt = now(); this.rate = r; }
    setVolume(v) { this.vol = v; }
    getVolume() { return this.vol; }
    getPlayerState() { return this.state; }
    getPlaylist() { return null; }
    destroy() { clearInterval(this.timer); this.box.remove(); }
  }
  window.YT = { Player, PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } };
  return true;
})();
