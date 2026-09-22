const form = document.querySelector('#ticket-form');
const subject = document.querySelector('#subject');
const sender = document.querySelector('#sender');
const body = document.querySelector('#body');
const button = document.querySelector('#generate');
const buttonLabel = button.querySelector('span');
const error = document.querySelector('#form-error');
const empty = document.querySelector('#empty');
const ticketView = document.querySelector('#ticket');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.textContent = '';
  const message = body.value.trim();
  if (!message) {
    error.textContent = 'Paste the email message before generating a ticket.';
    body.setAttribute('aria-invalid', 'true');
    requestAnimationFrame(() => body.focus());
    return;
  }
  body.removeAttribute('aria-invalid');
  button.disabled = true;
  buttonLabel.textContent = 'Generating…';
  try {
    const response = await fetch('/api/tickets', {
      method: 'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({subject: subject.value.trim(), sender: sender.value.trim(), body: message})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Ticket generation failed.');
    renderTicket(data.ticket);
  } catch (cause) {
    error.textContent = cause.message || 'Could not generate the ticket. Try again.';
  } finally {
    button.disabled = false;
    buttonLabel.textContent = 'Generate ticket';
  }
});

body.addEventListener('input', () => {
  if (body.value.trim()) {
    body.removeAttribute('aria-invalid');
    error.textContent = '';
  }
});

function renderTicket(ticket) {
  empty.hidden = true;
  ticketView.hidden = false;
  document.querySelector('#result-title').textContent = ticket.title;
  document.querySelector('#description').textContent = ticket.description;
  document.querySelector('#category').textContent = ticket.category;
  document.querySelector('#affected_system').textContent = ticket.affected_system;
  document.querySelector('#suggested_action').textContent = ticket.suggested_action;
  const urgency = document.querySelector('#urgency');
  urgency.textContent = `${ticket.urgency} urgency`;
  urgency.dataset.level = ticket.urgency;
  document.querySelector('#json').textContent = JSON.stringify(ticket, null, 2);
}
