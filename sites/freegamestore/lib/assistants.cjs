const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// A listing is advertised only after a maintainer records its live HTTPS URL.
function renderAssistants(clients) {
  return clients.map((client) => {
    const listed = client.listing?.live === true && /^https:\/\//.test(client.listing.url || '');
    return `<article class="ai-tool" id="assistant-${escape(client.id)}">
      <h3>${escape(client.name)}</h3>
      ${listed ? `<a class="tag" href="${escape(client.listing.url)}">Directory listing live</a>` : ''}
      <p>Server URL: <code>https://mcp.freegamestore.online/mcp</code></p>
      <ol>${client.steps.map((step) => `<li>${escape(step)}</li>`).join('')}</ol>
      ${client.snippet ? `<pre class="cmd cmd-pre"><code>${escape(client.snippet)}</code></pre>` : ''}
      <p><a href="${escape(client.docs)}">Client setup documentation</a></p>
    </article>`;
  }).join('\n');
}
module.exports = { renderAssistants };
