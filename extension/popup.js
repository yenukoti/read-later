const API_URL = 'https://read-later-six.vercel.app'

document.getElementById('save-btn').addEventListener('click', async () => {
  const btn = document.getElementById('save-btn')
  const status = document.getElementById('status')
  const inputUrl = document.getElementById('url-input').value.trim()

  // Get current tab URL if no URL typed
  let url = inputUrl
  if (!url) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    url = tab.url
  }

  // Don't save chrome:// or extension pages
  if (!url.startsWith('http')) {
    status.textContent = 'Cannot save this page'
    status.className = 'error'
    return
  }

  btn.disabled = true
  btn.textContent = 'Saving...'
  status.textContent = 'Scraping and summarizing...'
  status.className = 'loading'

  try {
    const res = await fetch(`${API_URL}/api/articles`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-user-id': 'local-user'
      },
      body: JSON.stringify({ url })
    })

    if (res.ok) {
      status.textContent = '✓ Saved! Summary coming in a few seconds'
      status.className = 'success'
      document.getElementById('url-input').value = ''
    } else {
      const err = await res.text()
      status.textContent = 'Error: ' + err
      status.className = 'error'
    }
  } catch (e) {
    status.textContent = 'Could not connect to server'
    status.className = 'error'
  } finally {
    btn.disabled = false
    btn.textContent = 'Save Article'
  }
})