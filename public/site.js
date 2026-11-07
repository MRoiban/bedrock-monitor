(() => {
  const data = JSON.parse(document.getElementById("snapshot").textContent);
  const heading = document.getElementById("headline");
  const observation = document.getElementById("observation");
  const status = document.querySelector(".status");
  const symbol = document.getElementById("status-icon");
  const unknownIcon = symbol.innerHTML;
  const tab = document.getElementById("favicon");
  function refresh() {
    if (!data.latest) { if (tab) tab.setAttribute("href", tab.dataset.unk); return; }
    const now = Date.now();
    const age = now - Date.parse(data.latest.observed_at);
    const clockInvalid = now < Date.parse(data.published_at) - 60_000 || age < 0;
    let tone = "unk", text = "Current status unknown";
    if (!clockInvalid && age <= data.stale_after_ms) {
      if (data.incident) {
        tone = data.latest.ok ? "warn" : "bad";
        text = data.latest.ok ? "Checks passing · confirming recovery" : "Home cloud — unreachable";
      } else {
        tone = data.latest.ok ? "ok" : "warn";
        text = data.latest.ok ? "Home cloud — reachable" : "Latest external check failed · confirming";
      }
    }
    if (heading.textContent !== text) heading.textContent = text;
    status.dataset.tone = tone;
    symbol.className = `st ${tone}`;
    symbol.innerHTML = tone === "unk" ? unknownIcon : document.getElementById(`icon-${tone}`).innerHTML;
    if (tab && tab.getAttribute("href") !== tab.dataset[tone]) tab.setAttribute("href", tab.dataset[tone]);
    const checkTime = data.latest.observed_at.slice(11, 16);
    const checkDate = data.latest.observed_at.slice(0, 10);
    const timeLabel = new Date(now).toISOString().slice(0, 10) === checkDate ? `${checkTime} UTC` : `${checkDate} ${checkTime} UTC`;
    observation.title = `Observation at ${data.latest.observed_at}`;
    observation.textContent = clockInvalid
      ? `Device clock uncertain · last observation ${data.latest.observed_at}: ${data.latest.ok ? "reachable" : "failed"}`
      : `${tone === "unk" ? "Last check" : "Last external check"} ${Math.floor(age / 60_000)} min ago (${timeLabel})${tone === "ok" ? "" : data.latest.ok ? ": reachable" : ": failed"}`;
    if (tone === "warn" && !data.latest.ok && data.last_success_at) {
      observation.textContent += ` · last successful check ${data.last_success_at.slice(0, 10)} ${data.last_success_at.slice(11, 16)} UTC`;
    }
    const recovery = document.getElementById("recovery-note");
    if (recovery) recovery.textContent = tone === "unk" ? "Last known incident remains unresolved." : data.latest.ok ? "Waiting for a second successful check." : `Unreachable since ${data.incident.opened_at.slice(11, 16)} UTC.`;
  }
  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 30_000);
  document.addEventListener("visibilitychange", refresh);
  window.addEventListener("pageshow", refresh);
})();
