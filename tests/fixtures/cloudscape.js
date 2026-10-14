// Shared by the Copilot fixtures (served by scripts/smoke-copilot.mjs at /awscity-fixture/*).
// Controls marked data-risky record any click on <body data-risky>, so the smoke run can prove the agent never clicked one.
document.addEventListener('click', (e) => {
  const r = e.target.closest && e.target.closest('[data-risky]');
  if (r) document.body.dataset.risky = (document.body.dataset.risky || '') + r.textContent.trim() + ';';
}, true);

/** A Cloudscape-like select: trigger opens on mousedown, an option selects on mouseup. */
function customSelect(host, { id, label, options, value }) {
  host.innerHTML = `
    <div class="awsui_form-field_x2">
      <label id="${id}-label" for="${id}-trigger">${label}</label>
      <div class="awsui_select_x5">
        <button type="button" class="awsui_button-trigger_x6" id="${id}-trigger" aria-haspopup="listbox" aria-expanded="false"
          aria-labelledby="${id}-label ${id}-value"><span id="${id}-value">${value}</span> ▾</button>
      </div>
    </div>`;
  const trigger = host.querySelector('button');
  const wrap = host.querySelector('.awsui_select_x5');
  let list;
  const close = () => { list?.remove(); list = undefined; trigger.setAttribute('aria-expanded', 'false'); trigger.removeAttribute('aria-controls'); };
  trigger.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (list) return close();
    // Cloudscape renders the dropdown after a frame; the Copilot has to wait for it.
    setTimeout(() => {
      list = document.createElement('div');
      list.className = 'awsui_dropdown_x7';
      list.innerHTML = `<ul role="listbox" id="${id}-list" aria-labelledby="${id}-label">` + options.map((o, i) =>
        `<li role="option" class="awsui_selectable-item_x8" aria-selected="${o.label === value}" data-i="${i}"${o.risky ? ' data-risky' : ''}>` +
        `<span class="awsui_label_xe">${o.label}</span>${o.description ? `<span class="awsui_description_x9">${o.description}</span>` : ''}</li>`).join('') + '</ul>';
      list.querySelector('ul').addEventListener('mouseup', (ev) => {
        const li = ev.target.closest('[role=option]');
        if (!li) return;
        const o = options[+li.dataset.i];
        if (o.risky) document.body.dataset.risky = (document.body.dataset.risky || '') + o.label + ';';
        value = o.label;
        host.querySelector(`#${id}-value`).textContent = value;
        host.dataset.value = value;
        close();
      });
      wrap.append(list);
      trigger.setAttribute('aria-expanded', 'true');
      trigger.setAttribute('aria-controls', `${id}-list`);
    }, 120);
  });
  host.dataset.value = value;
}
