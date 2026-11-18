(() => {
  const groupCards = document.getElementById('live-memberships');
  const privateCards = document.getElementById('live-private-memberships');
  const status = document.getElementById('membership-status');
  const portal = 'https://wba.exsportia.com/90305524/';
  const images = [
    '/img/studio/daylight-reformer-1000.webp', '/img/studio/mood-violet-1000.webp',
    '/img/studio/tower-flow-1000.webp', '/img/studio/close-up-1000.webp',
  ];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
  function money(amount, currency = 'THB') {
    return new Intl.NumberFormat('en', {style: 'currency', currency, maximumFractionDigits: 2}).format(amount);
  }
  function durationLabel(membership) {
    const units = {DAYS: 'day', WEEK: 'week', MONTH: 'month', YEAR: 'year'};
    const unit = units[membership.durationType];
    if (!unit || !(membership.duration > 0)) return '';
    return `${membership.duration} ${unit}${membership.duration === 1 ? '' : 's'}`;
  }
  function card(membership, index) {
    const activities = membership.activities || [];
    const isPrivate = activities.length > 0 && activities.every(activity => activity.groupType === 'service');
    const activity = activities.length === 1 ? activities[0] : null;
    const prices = membership.prices.filter(price => Number.isFinite(price.price) && price.price >= 0 && price.currency);
    const price = prices[0];
    const periods = {1: ' / week', 2: ' / month', 3: ' / year'};
    const priceText = prices.map(option => money(option.price, option.currency) + (periods[option.type] || '')).join(' or ');
    const count = activity?.frequencyType === 'IN_TOTAL' && activity.amountByType === 'AMOUNT_BY_ENTRIES' &&
      !activity.unlimited && activity.frequencyAmount > 0 ? activity.frequencyAmount : null;
    const perClass = count && price && !periods[price.type] ?
      `<div class="per">${escape(money(price.price / count, price.currency))} per class</div>` : '';
    const duration = durationLabel(membership);
    const image = /^https:\/\//.test(membership.image) ? membership.image : images[index % images.length];
    const description = membership.description.trim();
    const sentences = description.split(/(?<=[.!?])\s+|\n/).filter(Boolean);
    const summary = sentences[0] || '';
    const benefit = sentences.find(sentence => /special privileges|complimentary friend|free \d+x/i.test(sentence) && sentence !== summary);
    return `<article class="pack live-membership" data-membership-id="${escape(membership.id)}">
      <img class="pack-cover" src="${escape(image)}" alt="" loading="lazy" width="620" height="280">
      <div class="pack-label">${isPrivate ? 'Private practice' : 'Membership'}</div>
      <h3 class="membership-name">${escape(membership.name)}</h3>
      ${priceText ? `<div class="price">${escape(priceText)}</div>` : ''}
      ${perClass}
      ${duration ? `<p class="per">Valid for ${escape(duration)}${membership.startDateType === 'USER_SELECTED_DATE' ? ' from your chosen start date' : ''}</p>` : ''}
      ${summary ? `<p class="membership-description">${escape(summary)}</p>` : ''}
      ${benefit ? `<p class="membership-benefit">${escape(benefit)}</p>` : ''}
      ${description !== summary ? `<details class="membership-more"><summary>Membership details</summary><p class="membership-description">${escape(description)}</p></details>` : ''}
      <a class="btn sm${isPrivate ? '' : ' ghost'}" href="${portal}subscription/${encodeURIComponent(membership.id)}" data-cta="Membership: ${escape(membership.name)}">View &amp; buy</a>
    </article>`;
  }
  let loading = false;
  async function refresh() {
    if (loading) return;
    loading = true;
    try {
      const response = await fetch('/api/memberships', {cache: 'no-store'});
      if (!response.ok) throw new Error('Membership catalogue unavailable');
      const {memberships} = await response.json();
      if (!Array.isArray(memberships)) throw new Error('Invalid membership catalogue');
      const privateMemberships = memberships.filter(membership =>
        membership.activities.length > 0 && membership.activities.every(activity => activity.groupType === 'service'));
      groupCards.querySelectorAll('.live-membership').forEach(element => element.remove());
      groupCards.insertAdjacentHTML('beforeend', memberships.filter(membership => !privateMemberships.includes(membership)).map(card).join(''));
      privateCards.innerHTML = privateMemberships.map(card).join('');
      status.textContent = memberships.length ? 'Current memberships · choose a package to see full details and buy online.' : 'Please check the booking portal for current memberships.';
    } catch {
      groupCards.querySelectorAll('.live-membership').forEach(element => element.remove());
      privateCards.innerHTML = '';
      status.innerHTML = `Current memberships are temporarily unavailable. <a href="${portal}">View memberships in the booking portal ↗</a>`;
    } finally {
      groupCards.setAttribute('aria-busy', 'false');
      loading = false;
    }
  }
  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
