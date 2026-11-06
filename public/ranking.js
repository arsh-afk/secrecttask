// ranking.js – fetch and render fastest completion rankings
function loadRankings() {
  fetch('/rankings')
    .then(r => r.json())
    .then(data => render(data))
    .catch(err => console.error('Ranking fetch error', err));
}
function render(list) {
  const tbody = document.querySelector('#rankTable tbody');
  tbody.innerHTML = '';
  list.forEach((row, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${idx + 1}</td>` +
                  `<td>${row.userId}</td>` +
                  `<td>${row.score ?? 0}</td>` +
                  `<td>${row.completionTime ?? '—'}</td>`;
    tbody.appendChild(tr);
  });
}
// Load as soon as page is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadRankings);
} else {
  loadRankings();
}

