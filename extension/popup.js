const STORAGE_KEY = "iamProbeEndpoint";

const endpointInput = document.getElementById("endpoint");
const runButton = document.getElementById("run");
const statusEl = document.getElementById("status");
const resultsTable = document.getElementById("results");

chrome.storage.local.get(STORAGE_KEY, (data) => {
  if (data[STORAGE_KEY]) endpointInput.value = data[STORAGE_KEY];
});

runButton.addEventListener("click", runProbe);

async function runProbe() {
  const url = endpointInput.value.trim();
  if (!url) {
    setStatus("Enter the API endpoint first.", true);
    return;
  }

  chrome.storage.local.set({ [STORAGE_KEY]: url });

  let origin;
  try {
    origin = new URL(url).origin + "/*";
  } catch {
    setStatus("That's not a valid URL.", true);
    return;
  }

  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) {
    setStatus("Permission to call that host was denied.", true);
    return;
  }

  setStatus("Calling...");
  resultsTable.innerHTML = "";

  try {
    const resp = await fetch(url);
    const body = await resp.json();
    render(body);
    setStatus(`HTTP ${resp.status}`);
  } catch (err) {
    setStatus(`Request failed: ${err.message}`, true);
  }
}

function render(body) {
  const rows = normalize(body);
  const header = document.createElement("tr");
  header.innerHTML = "<th>Call</th><th>Allowed</th><th>Detail</th>";
  resultsTable.appendChild(header);

  for (const row of rows) {
    const tr = document.createElement("tr");
    const detail = row.allowed
      ? row.note || JSON.stringify(row.result ?? "")
      : row.error || row.error_message || "";

    tr.innerHTML = `
      <td>${escapeHtml(row.call)}</td>
      <td class="${row.allowed ? "allowed" : "denied"}">${row.allowed ? "yes" : "no"}</td>
      <td>${escapeHtml(String(detail)).slice(0, 200)}</td>
    `;
    resultsTable.appendChild(tr);
  }
}

// Accepts either {"<call>": {allowed, ...}, ...} or {"results": [{call, allowed, ...}, ...]}
function normalize(body) {
  if (Array.isArray(body?.results)) return body.results;
  return Object.entries(body).map(([call, v]) => ({ call, ...v }));
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#b00020" : "#666";
}
