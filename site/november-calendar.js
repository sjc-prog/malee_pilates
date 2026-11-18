(() => {
  const date = document.getElementById('flow-date');
  const days = document.querySelector('.flow-days');
  const list = document.getElementById('flow-list');
  const previous = document.getElementById('flow-prev');
  const next = document.getElementById('flow-next');
  const filters = document.querySelectorAll('[data-flow-filter]');
  const portal = 'https://wba.exsportia.com/90305524/class/';
  const colors = {
    'Full Body Flow': '#e8ce71', Beginner: '#a8c6a1', 'Booty & Core': '#afc8e7',
    'Sunset Tone': '#afc8e7', Jumpboard: '#e6aaa6',
  };
  const escape = value => String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
  const isoDate = day => `2026-11-${String(day).padStart(2, '0')}`;
  const localDay = day => new Date(2026, 10, day);
  const clock = timestamp => new Date(timestamp).toISOString().slice(11, 16);
  const today = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Bangkok', year: 'numeric', month: 'numeric', day: 'numeric'}).formatToParts();
  const part = type => Number(today.find(entry => entry.type === type).value);
  let selected = part('year') === 2026 && part('month') === 11 ? part('day') : 1;
  let filter = 'all';
  let request;

  async function render() {
    request?.abort();
    request = new AbortController();
    const {signal} = request;
    const start = Math.floor((selected - 1) / 7) * 7 + 1;
    days.innerHTML = Array.from({length: 7}, (_, index) => {
      const day = start + index;
      const weekday = localDay(day).toLocaleDateString('en', {weekday: 'short'});
      return `<button type="button" data-day="${day}" aria-pressed="${day === selected}" ${day > 30 ? 'disabled' : ''}><span>${weekday}</span><b>${day > 30 ? '—' : day}</b></button>`;
    }).join('');
    document.getElementById('flow-heading').textContent = localDay(selected).toLocaleDateString('en', {
      weekday: 'long', day: 'numeric', month: 'short',
    });
    date.value = isoDate(selected);
    previous.disabled = start === 1;
    next.disabled = start === 29;
    list.innerHTML = '<p class="flow-empty">Loading classes…</p>';
    try {
      const response = await fetch(`/api/bophut-schedule?date=${date.value}`, {signal});
      if (!response.ok) throw new Error('Schedule unavailable');
      const sessions = await response.json();
      if (signal.aborted) return;
      list.innerHTML = sessions.filter(session => filter === 'all' || session.name === filter)
        .map(({timestamp, duration, name, teachers, classId, price, bookable}) => `
          <div class="flow-row">
            <time class="flow-time">${clock(timestamp)}<small>${clock(timestamp + duration * 60000)}</small></time>
            <div class="flow-class" style="--flow-color:${colors[name] || '#a8c6a1'}">
              <strong>${escape(name)}</strong>
              <small>${teachers.length ? `${teachers.map(teacher => 'Kru ' + escape(teacher)).join(', ')} · ` : ''}Bophut · ฿${Number(price).toLocaleString('en')}</small>
            </div>
            ${bookable ? `<a class="flow-book" aria-label="Book ${escape(name)}; see live dates" href="${portal}${encodeURIComponent(classId)}/select-session/">Book ↗</a>` : '<span>Unavailable</span>'}
          </div>`).join('') || '<p class="flow-empty">No matching classes on this date. Try another date or choose All classes.</p>';
    } catch {
      if (!signal.aborted) list.innerHTML = `<p class="flow-empty">The schedule is temporarily unavailable. <a href="${portal}schedule/select-session/">See the live booking portal ↗</a></p>`;
    }
  }

  days.addEventListener('click', event => {
    const button = event.target.closest('[data-day]');
    if (!button || button.disabled) return;
    selected = Number(button.dataset.day);
    render();
  });
  date.addEventListener('change', () => {
    if (!date.value || !date.checkValidity()) return;
    selected = Number(date.value.slice(-2));
    render();
  });
  filters.forEach(button => button.addEventListener('click', () => {
    filter = button.dataset.flowFilter;
    filters.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    render();
  }));
  previous.onclick = () => { selected = Math.max(1, selected - 7); render(); };
  next.onclick = () => { selected = Math.min(30, selected + 7); render(); };
  render();
})();
