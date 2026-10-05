    const lines = [
      { type: 'cmd', prompt: '~ $', text: 'npm install -g @freegamestore/cli', delay: 40 },
      { type: 'output', text: 'added 1 package in 3s', delay: 800 },
      { type: 'pause', delay: 400 },
      { type: 'cmd', prompt: '~ $', text: 'fgs login', delay: 50 },
      { type: 'success', text: '✓ Logged in as your-username', delay: 600 },
      { type: 'pause', delay: 400 },
      { type: 'cmd', prompt: '~ $', text: 'fgs init my-game --template canvas', delay: 35 },
      { type: 'output', text: '', delay: 200 },
      { type: 'output', text: '  Creating My Game...', delay: 300 },
      { type: 'output', text: '', delay: 100 },
      { type: 'output', text: '  [1/3] Scaffolding from template-game-canvas...', delay: 400 },
      { type: 'output', text: '  [2/3] Installing dependencies...', delay: 800 },
      { type: 'output', text: '  [3/3] Initializing git...', delay: 400 },
      { type: 'success', text: '  Done! Your game is ready.', delay: 300 },
      { type: 'pause', delay: 500 },
      { type: 'cmd', prompt: '~ $', text: 'cd my-game', delay: 50 },
      { type: 'pause', delay: 300 },
      { type: 'cmd', prompt: 'my-game $', text: 'pnpm dev', delay: 40 },
      { type: 'output', text: '', delay: 200 },
      { type: 'highlight', text: '  VITE v8.0.10  ready in 180ms', delay: 400 },
      { type: 'output', text: '', delay: 100 },
      { type: 'url', text: '  ➜  Local:   http://localhost:5173/', delay: 300 },
      { type: 'url', text: '  ➜  Network: http://192.168.1.42:5173/', delay: 200 },
      { type: 'output', text: '', delay: 100 },
      { type: 'success', text: '  ✓ Game running — open your browser!', delay: 0 },
    ];

    const term = document.getElementById('term');
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    async function typeLine(el, text, charDelay) {
      const span = el.querySelector('.typed');
      for (let i = 0; i < text.length; i++) { span.textContent += text[i]; await sleep(charDelay); }
    }
    async function runDemo() {
      term.innerHTML = '';
      for (const line of lines) {
        if (line.type === 'pause') { await sleep(line.delay); continue; }
        const div = document.createElement('div');
        div.className = 'terminal-line';
        if (line.type === 'cmd') {
          div.innerHTML = `<span class="prompt">${line.prompt} </span><span class="typed"></span><span class="cursor"></span>`;
          div.classList.add('copyable');
          div.dataset.cmd = line.text;
          term.appendChild(div); div.classList.add('visible');
          await typeLine(div, line.text, line.delay);
          div.querySelector('.cursor').remove(); await sleep(300);
        } else {
          const cls = line.type === 'success' ? 'success' : line.type === 'url' ? 'url' : line.type === 'highlight' ? 'highlight' : 'output';
          div.innerHTML = `<span class="${cls}">${line.text}</span>`;
          term.appendChild(div); await sleep(line.delay); div.classList.add('visible');
        }
        term.scrollTop = term.scrollHeight;
      }
    }
    runDemo();

    // Replay button (CSP-safe replacement for the old inline onclick="runDemo()").
    var replayBtn = document.getElementById('replayBtn');
    if (replayBtn) replayBtn.addEventListener('click', runDemo);

    document.getElementById('term').addEventListener('click', (e) => {
      const line = e.target.closest('.copyable');
      if (!line) return;
      navigator.clipboard.writeText(line.dataset.cmd);
      line.classList.add('copied');
      setTimeout(() => line.classList.remove('copied'), 1500);
    });

    document.querySelectorAll('.terminal-body .terminal-line.visible').forEach(el => {
      const prompt = el.querySelector('.prompt');
      const cmd = el.querySelector('.cmd');
      if (!prompt || !cmd) return;
      el.classList.add('copy-line');
      el.dataset.cmd = cmd.textContent;
      el.addEventListener('click', () => {
        navigator.clipboard.writeText(el.dataset.cmd);
        el.classList.add('copied');
        setTimeout(() => el.classList.remove('copied'), 1500);
      });
    });
