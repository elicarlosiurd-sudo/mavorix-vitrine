/* Água no vidro das vitrines.
   As gotas funcionam como lente: cada uma mostra, invertida e ampliada, a cena
   que está atrás dela. As pequenas ficam paradas (condensação), as pesadas
   escorrem, limpam o caminho, engolem o que encontram e deixam rastro molhado. */
(function () {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[(Math.random() * arr.length) | 0];

  class Vidro {
    constructor(el) {
      this.el = el;
      this.tile = el.closest('.tile');
      this.img = this.tile && this.tile.querySelector('img');
      this.fixo = document.createElement('canvas');     // condensação e rastros
      this.vivo = document.createElement('canvas');     // gotas que escorrem
      [this.fixo, this.vivo].forEach(c => { c.className = 'cv'; el.appendChild(c); });
      this.cf = this.fixo.getContext('2d');
      this.cv = this.vivo.getContext('2d');
      el.style.backgroundImage = 'none';
      this.correndo = []; this.visivel = false; this.raf = null; this.last = 0;
      this.montar();
      if (this.img && !this.img.complete) this.img.addEventListener('load', () => this.montar(), { once: true });
      new IntersectionObserver(e => { this.visivel = e[0].isIntersecting; this.ligar(); }, { rootMargin: '140px' }).observe(el);
      addEventListener('resize', () => { clearTimeout(this.rz); this.rz = setTimeout(() => this.montar(), 180); });
      document.addEventListener('visibilitychange', () => this.ligar());
      reduce.addEventListener('change', () => this.ligar());
    }

    /* a cena que as gotas enxergam: o fundo claro do vidro e o produto */
    cena() {
      const s = document.createElement('canvas');
      s.width = Math.round(this.w * this.dpr); s.height = Math.round(this.h * this.dpr);
      const c = s.getContext('2d'); c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const g = c.createRadialGradient(this.w * .56, this.h * .32, 10, this.w * .56, this.h * .32, Math.max(this.w, this.h) * .8);
      g.addColorStop(0, '#ffffff'); g.addColorStop(.55, '#eef1ef'); g.addColorStop(1, '#ccd3d1');
      c.fillStyle = g; c.fillRect(0, 0, this.w, this.h);
      if (this.img && this.img.complete && this.img.naturalWidth) {
        const a = this.img.getBoundingClientRect(), b = this.el.getBoundingClientRect();
        const bw = a.width, bh = a.height, ar = this.img.naturalWidth / this.img.naturalHeight;
        let dw = bw, dh = bw / ar; if (dh > bh) { dh = bh; dw = bh * ar; }
        c.drawImage(this.img, a.left - b.left + (bw - dw) / 2, a.top - b.top + (bh - dh) / 2, dw, dh);
      }
      return s;
    }

    montar() {
      const r = this.el.getBoundingClientRect();
      this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
      this.dpr = Math.min(innerWidth < 720 ? 1.35 : 1.75, devicePixelRatio || 1);
      for (const c of [this.fixo, this.vivo]) {
        c.width = Math.round(this.w * this.dpr); c.height = Math.round(this.h * this.dpr);
      }
      this.cf.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.cv.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.scene = this.cena();
      this.condensar();
      this.correndo = [];
      this.limite = Math.max(2, Math.min(7, Math.round(this.w * this.h / 60000)));
      for (let i = 0; i < this.limite; i++) this.nova(rnd(-this.h * .4, this.h * .6));
      this.cv.clearRect(0, 0, this.w, this.h);
    }

    /* caminho irregular: gota achatada, nunca um círculo perfeito */
    caminho(c, x, y, rx, ry, sem) {
      c.beginPath();
      const n = 9;
      for (let i = 0; i <= n; i++) {
        const a = i / n * Math.PI * 2;
        const k = 1 + Math.sin(a * 3 + sem) * .06 + Math.cos(a * 2 + sem * 1.7) * .05;
        const px = x + Math.cos(a) * rx * k, py = y + Math.sin(a) * ry * k;
        i ? c.lineTo(px, py) : c.moveTo(px, py);
      }
      c.closePath();
    }

    /* desenha uma gota com refração, borda e brilho */
    gota(c, x, y, rx, ry, sem, sombra) {
      c.save();
      if (sombra) { c.shadowColor = 'rgba(24,30,36,.24)'; c.shadowBlur = Math.max(rx, ry) * .7; c.shadowOffsetY = Math.max(rx, ry) * .3; }
      this.caminho(c, x, y, rx, ry, sem);
      c.save(); c.clip();
      const k = .34;                                   // o quanto a lente amplia
      c.translate(x, y); c.scale(-1, -1); c.translate(-x, -y);   // a lente inverte
      c.drawImage(this.scene, (x - rx * k) * this.dpr, (y - ry * k) * this.dpr, rx * 2 * k * this.dpr, ry * 2 * k * this.dpr, x - rx, y - ry, rx * 2, ry * 2);
      c.restore();
      const borda = c.createRadialGradient(x - rx * .3, y - ry * .35, rx * .1, x, y, Math.max(rx, ry));
      borda.addColorStop(0, 'rgba(255,255,255,.4)');
      borda.addColorStop(.5, 'rgba(255,255,255,0)');
      borda.addColorStop(.8, 'rgba(48,58,66,.34)');
      borda.addColorStop(.94, 'rgba(36,44,52,.2)');
      borda.addColorStop(1, 'rgba(255,255,255,.9)');
      c.fillStyle = borda; c.fill();
      if (rx > 2.2) {                                   // brilho da luz no alto e devolução embaixo
        c.beginPath();
        c.ellipse(x - rx * .36, y - ry * .44, rx * .22, ry * .16, -.5, 0, 6.2832);
        c.fillStyle = 'rgba(255,255,255,.95)'; c.fill();
        c.beginPath();
        c.ellipse(x + rx * .26, y + ry * .44, rx * .3, ry * .14, .3, 0, 6.2832);
        c.fillStyle = 'rgba(255,255,255,.34)'; c.fill();
      }
      c.restore();
    }

    condensar() {
      const c = this.cf;
      c.clearRect(0, 0, this.w, this.h);
      const area = this.w * this.h;
      const denso = innerWidth < 720 ? 260 : 190;
      const micro = Math.round(area / denso), medio = Math.round(area / 2400);
      for (let i = 0; i < micro; i++) {
        const r = rnd(.5, 1.7), f = rnd(.72, 1);
        this.gota(c, rnd(0, this.w), rnd(0, this.h), r, r * f, rnd(0, 6));
      }
      for (let i = 0; i < medio; i++) {
        const r = rnd(2, 5.4), f = rnd(.62, .92);
        this.gota(c, rnd(0, this.w), rnd(0, this.h), r, r * f, rnd(0, 6));
      }
    }

    nova(y0) {
      const r = rnd(5.5, 11);
      this.correndo.push({ x: rnd(this.w * .05, this.w * .95), y: y0 ?? rnd(-40, -8), r, v: rnd(.0012, .0035), pausa: rnd(0, 900) });
    }

    passo(dt) {
      const c = this.cf;
      for (let i = this.correndo.length - 1; i >= 0; i--) {
        const d = this.correndo[i];
        // a gota gruda no vidro, engorda e só então desliza de novo
        if (d.pausa > 0) {
          d.pausa -= dt;
          d.v *= .88;
          d.r += .00022 * dt;
          if (d.pausa <= 0) d.v = .0016 + d.r * .00035;
          continue;
        }
        const limite = .006 + d.r * .0009;              // velocidade máxima, bem lenta
        d.v += (d.r - 3.6) * .0000055 * dt;
        if (d.v > limite) d.v = limite;
        const passo = d.v * dt;
        d.y += passo;
        d.x += Math.sin((d.y + i * 53) * .01) * .006 * dt;
        d.r -= passo * .009;                            // perde água no caminho
        if (Math.random() < .004 * dt / 16) d.pausa = rnd(500, 2600);   // agarra no vidro
        // limpa o vidro por onde passou e deixa o rastro molhado
        c.save();
        c.globalCompositeOperation = 'destination-out';
        c.beginPath(); c.ellipse(d.x, d.y - passo / 2, d.r * .92, (passo + d.r * 1.4) / 2, 0, 0, 6.2832); c.fill();
        c.restore();
        c.save();
        c.globalAlpha = .42;
        c.fillStyle = 'rgba(255,255,255,.5)';
        c.fillRect(d.x - d.r * .6, d.y - passo - d.r * .2, d.r * 1.2, passo + d.r * .4);
        c.restore();
        if (Math.random() < .12) {                       // gotinhas soltas no rastro
          const rr = rnd(.6, 1.6);
          this.gota(c, d.x + rnd(-d.r * .8, d.r * .8), d.y - rnd(d.r, d.r * 3), rr, rr * .85, rnd(0, 6));
        }
        if (d.y - d.r > this.h || d.r < 2) { this.correndo.splice(i, 1); this.nova(); }
      }
      if (this.correndo.length < this.limite && Math.random() < .015) this.nova();
      // o vapor volta a condensar, senão o vidro secaria com o tempo
      const quantas = .5 * dt / 16;
      for (let k = 0; k < quantas || Math.random() < quantas; k++) {
        const r = rnd(.5, 1.6);
        this.gota(c, rnd(0, this.w), rnd(0, this.h), r, r * rnd(.72, 1), rnd(0, 6));
        if (k > 3) break;
      }
    }

    desenhar() {
      const c = this.cv;
      c.clearRect(0, 0, this.w, this.h);
      for (const d of this.correndo) {
        // corpo alongado, com a cauda apontando para cima
        c.save();
        c.globalAlpha = .34;
        c.fillStyle = 'rgba(255,255,255,.55)';
        c.beginPath(); c.moveTo(d.x - d.r * .3, d.y); c.quadraticCurveTo(d.x, d.y - d.r * 3.4, d.x + d.r * .3, d.y); c.fill();
        c.restore();
        this.gota(c, d.x, d.y, d.r * .92, d.r * 1.18, d.x + d.y, true);
      }
    }

    tick(now) {
      const dt = Math.min(48, now - (this.last || now)); this.last = now;
      this.passo(dt); this.desenhar();
      this.raf = requestAnimationFrame(t => this.tick(t));
    }
    ligar() {
      const rodar = this.visivel && !document.hidden && !reduce.matches;
      if (rodar && this.raf === null) { this.last = 0; this.raf = requestAnimationFrame(t => this.tick(t)); }
      if (!rodar && this.raf !== null) { cancelAnimationFrame(this.raf); this.raf = null; this.desenhar(); }
    }
  }

  const start = () => document.querySelectorAll('.tile .drops').forEach(el => new Vidro(el));
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', start); else start();
})();
