// Initialize extension state
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    isActive: false,
    contacts: [],
    matchMode: 'ANY',
    visibleFields: {
      name: true,
      company: true,
      email: true,
      address: true,
      phone: true,
      position: true,
      website: true
    }
  });
});

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'toggleScraping') {
    handleScrapingToggle(message.isActive, message.visibleFields, message.matchMode);
  } else if (message.action === 'newContact') {
    handleNewContact(message.contact);
  } else if (message.action === 'updateMatchMode') {
    handleMatchModeUpdate(message.matchMode);
  } else if (message.action === 'updateVisibleFields') {
    handleVisibleFieldsUpdate(message.visibleFields, message.matchMode);
  }
});

// Store current settings
let currentVisibleFields = null;
let currentMatchMode = 'ANY';

// Handle scraping toggle
async function handleScrapingToggle(isActive, visibleFields, matchMode) {
  currentVisibleFields = visibleFields;
  currentMatchMode = matchMode;
  
  // Get all tabs
  const tabs = await chrome.tabs.query({});
  
  // Notify all tabs about the state change
  tabs.forEach(tab => {
    chrome.tabs.sendMessage(tab.id, {
      action: 'updateScrapingState',
      isActive: isActive
    }).catch(() => {
      // Ignore errors for tabs that don't have the content script
    });
  });
}

// Handle match mode update
function handleMatchModeUpdate(matchMode) {
  currentMatchMode = matchMode;
}

// Handle visible fields update
function handleVisibleFieldsUpdate(visibleFields, matchMode) {
  currentVisibleFields = visibleFields;
  currentMatchMode = matchMode;
}

// Handle new contact data
async function handleNewContact(newContact) {
  // Load settings if needed
  if (!currentVisibleFields || !currentMatchMode) {
    const { visibleFields, matchMode } = await chrome.storage.local.get(['visibleFields', 'matchMode']);
    currentVisibleFields = visibleFields;
    currentMatchMode = matchMode;
  }

  // Get selected fields
  const selectedFields = Object.entries(currentVisibleFields)
    .filter(([_, isVisible]) => isVisible)
    .map(([field]) => field);

  // In ANY mode, save if any field has data
  if (currentMatchMode === 'ANY') {
    const hasAnyData = selectedFields.some(field => 
      newContact[field] && newContact[field].toString().trim() !== ''
    );
    if (!hasAnyData) return;
  }
  // In ALL mode, only save if ALL selected fields have data
  else {
    const allFieldsHaveData = selectedFields.every(field => 
      newContact[field] && newContact[field].toString().trim() !== ''
    );
    if (!allFieldsHaveData) return;
  }

  // Get existing contacts
  const { contacts = [] } = await chrome.storage.local.get(['contacts']);
  
  // Check for duplicates
  const isDuplicate = contacts.some(contact => 
    (contact.email && newContact.email && contact.email.toLowerCase() === newContact.email.toLowerCase()) || 
    (contact.phone && newContact.phone && contact.phone.replace(/\D/g, '') === newContact.phone.replace(/\D/g, ''))
  );
  
  if (!isDuplicate) {
    // Clean and save the contact
    const cleanContact = {};
    selectedFields.forEach(field => {
      if (newContact[field]) {
        cleanContact[field] = newContact[field].toString().trim();
      }
    });
    cleanContact.timestamp = new Date().toISOString();
    contacts.push(cleanContact);
    await chrome.storage.local.set({ contacts });
  }
}

// Listen for tab updates to inject content script when necessary
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    const { isActive = false } = await chrome.storage.local.get(['isActive']);
    
    if (isActive) {
      // Notify content script about active state
      chrome.tabs.sendMessage(tabId, {
        action: 'updateScrapingState',
        isActive: true
      }).catch(() => {
        // Ignore errors for tabs that don't have the content script
      });
    }
  }
}); 