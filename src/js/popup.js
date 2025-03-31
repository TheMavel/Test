document.addEventListener('DOMContentLoaded', async () => {
  const toggle = document.getElementById('scraping-toggle');
  const exportBtn = document.getElementById('export-csv');
  const clearBtn = document.getElementById('clear-data');
  const contactCount = document.getElementById('contact-count');
  const statusMessage = document.getElementById('status-message');
  const contactsDisplay = document.getElementById('contacts-display');
  const fieldTogglesContainer = document.querySelector('.field-toggles');
  const matchModeBtn = document.getElementById('match-mode-toggle');
  const matchModeLabel = document.querySelector('.match-mode-label');

  // Default field visibility state
  const defaultVisibleFields = {
    name: true,
    company: true,
    email: true,
    address: true,
    phone: true,
    position: true,
    website: true
  };

  // Load initial state including field visibility and match mode
  const { 
    isActive = false, 
    contacts = [], 
    visibleFields = defaultVisibleFields,
    matchMode = 'ANY'
  } = await chrome.storage.local.get(['isActive', 'contacts', 'visibleFields', 'matchMode']);
  
  // Function to update field toggles
  function updateFieldToggles(fields) {
    // Clear existing toggles except the title
    const title = fieldTogglesContainer.querySelector('h3');
    fieldTogglesContainer.innerHTML = '';
    fieldTogglesContainer.appendChild(title);

    // Sort fields alphabetically
    fields.sort().forEach(field => {
      const toggleDiv = document.createElement('div');
      toggleDiv.className = 'field-toggle';
      
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.field = field;
      input.checked = visibleFields[field] !== false; // Default to true if not set
      
      // Capitalize first letter and format field name
      const fieldName = field.charAt(0).toUpperCase() + field.slice(1).replace(/([A-Z])/g, ' $1');
      
      label.appendChild(input);
      label.appendChild(document.createTextNode(fieldName));
      toggleDiv.appendChild(label);
      fieldTogglesContainer.appendChild(toggleDiv);
    });

    // Add event listeners to new toggles
    const fieldToggles = document.querySelectorAll('.field-toggle input[type="checkbox"]');
    fieldToggles.forEach(toggle => {
      toggle.addEventListener('change', async () => {
        const field = toggle.dataset.field;
        visibleFields[field] = toggle.checked;
        await chrome.storage.local.set({ visibleFields });
        chrome.runtime.sendMessage({ 
          action: 'updateVisibleFields', 
          visibleFields,
          matchMode: matchModeBtn.textContent
        });
        displayContacts(contacts);
      });
    });
  }

  // Function to get all unique fields from contacts
  function getAllFields(contacts) {
    const fields = new Set();
    contacts.forEach(contact => {
      Object.keys(contact).forEach(field => {
        if (field !== 'timestamp') { // Exclude timestamp field
          fields.add(field);
        }
      });
    });
    return Array.from(fields);
  }

  // Initialize fields
  const initialFields = contacts.length > 0 
    ? getAllFields(contacts)
    : ['name', 'company', 'email', 'address', 'phone', 'position', 'website'];
  updateFieldToggles(initialFields);

  // Set initial toggle states
  toggle.checked = isActive;
  contactCount.textContent = contacts.length;
  
  // Set initial match mode
  matchModeBtn.textContent = matchMode;
  matchModeBtn.classList.toggle('all', matchMode === 'ALL');
  updateMatchModeLabel(matchMode);
  
  // Display initial contacts
  displayContacts(contacts);

  // Handle match mode toggle
  matchModeBtn.addEventListener('click', async () => {
    const newMode = matchModeBtn.textContent === 'ANY' ? 'ALL' : 'ANY';
    matchModeBtn.textContent = newMode;
    matchModeBtn.classList.toggle('all', newMode === 'ALL');
    updateMatchModeLabel(newMode);
    
    // Save match mode setting
    await chrome.storage.local.set({ matchMode: newMode });
    
    // Notify background script of mode change
    chrome.runtime.sendMessage({ 
      action: 'updateMatchMode', 
      matchMode: newMode 
    });
  });

  function updateMatchModeLabel(mode) {
    matchModeLabel.textContent = `Match Mode: Match ${mode} selected field${mode === 'ALL' ? 's' : ''}`;
  }

  // Toggle scraping
  toggle.addEventListener('change', async () => {
    const isActive = toggle.checked;
    await chrome.storage.local.set({ isActive });
    
    // Notify background script
    chrome.runtime.sendMessage({ 
      action: 'toggleScraping', 
      isActive,
      visibleFields,
      matchMode: matchModeBtn.textContent
    });
    
    statusMessage.textContent = isActive ? 'Scraping activated' : 'Scraping deactivated';
    setTimeout(() => {
      statusMessage.textContent = '';
    }, 2000);
  });

  // Function to display contacts
  function displayContacts(contacts) {
    contactsDisplay.innerHTML = '';
    
    if (contacts.length === 0) {
      contactsDisplay.innerHTML = '<div class="contact-card">No contacts found yet.</div>';
      return;
    }

    contacts.forEach(contact => {
      const card = document.createElement('div');
      card.className = 'contact-card';
      
      const fields = [
        { key: 'name', label: 'Name' },
        { key: 'company', label: 'Company' },
        { key: 'email', label: 'Email' },
        { key: 'address', label: 'Address' },
        { key: 'phone', label: 'Phone' },
        { key: 'position', label: 'Position' },
        { key: 'website', label: 'Website' }
      ];

      fields.forEach(({ key, label }) => {
        if (visibleFields[key] && contact[key]) {
          const field = document.createElement('div');
          field.className = 'contact-field';
          field.innerHTML = `
            <span class="label">${label}:</span>
            <span class="value">${contact[key]}</span>
          `;
          card.appendChild(field);
        }
      });

      contactsDisplay.appendChild(card);
    });
  }

  // Export to CSV
  exportBtn.addEventListener('click', async () => {
    const { contacts = [] } = await chrome.storage.local.get(['contacts']);
    
    if (contacts.length === 0) {
      statusMessage.textContent = 'No contacts to export';
      setTimeout(() => {
        statusMessage.textContent = '';
      }, 2000);
      return;
    }

    // Only export visible fields
    const headers = Object.entries(visibleFields)
      .filter(([_, isVisible]) => isVisible)
      .map(([field]) => field);

    const csvContent = [
      headers.join(','),
      ...contacts.map(contact => 
        headers.map(header => 
          JSON.stringify(contact[header] || '')
        ).join(',')
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const timestamp = new Date().toISOString().split('T')[0];
    
    chrome.downloads.download({
      url: url,
      filename: `b2b_contacts_${timestamp}.csv`
    });

    statusMessage.textContent = 'Contacts exported successfully';
    setTimeout(() => {
      statusMessage.textContent = '';
    }, 2000);
  });

  // Clear data
  clearBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear all stored contacts?')) {
      await chrome.storage.local.set({ contacts: [] });
      contactCount.textContent = '0';
      displayContacts([]);
      
      statusMessage.textContent = 'All contacts cleared';
      setTimeout(() => {
        statusMessage.textContent = '';
      }, 2000);
    }
  });

  // Listen for contact updates
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.contacts) {
      const newContacts = changes.contacts.newValue;
      contactCount.textContent = newContacts.length;
      
      // Update field toggles if new fields are found
      const currentFields = getAllFields(newContacts);
      if (currentFields.length > initialFields.length) {
        updateFieldToggles(currentFields);
      }
      
      displayContacts(newContacts);
    }
  });
}); 