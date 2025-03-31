// Global state
let isScrapingActive = false;
let processedEmails = new Set();
let processedPhones = new Set();

// Regular expressions for contact information
const patterns = {
  // Enhanced email pattern to better match various email formats
  email: /[\w.%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|[\w.%+-]+(?:@|\s*\[@\]\s*)(?:gmail\.com|yahoo\.com|hotmail\.com|outlook\.com)/gi,
  phone: /(?:\+\d{1,3}[-. ]?)?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}/g,
  name: /^[A-Z][a-z]+(?: [A-Z][a-z]+)+$/,
};

// Initialize extension
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'updateScrapingState') {
    isScrapingActive = message.isActive;
    if (isScrapingActive) {
      scanPage();
    }
  }
});

// Main scanning function
function scanPage() {
  if (!isScrapingActive) return;

  // Scan visible text content
  scanVisibleContent();
  
  // Scan HTML attributes that might contain contact info
  scanAttributes();
  
  // Look for structured data
  scanStructuredData();
  
  // Process meta tags
  scanMetaTags();
  
  // Scan for obfuscated emails
  scanObfuscatedEmails();
}

// Scan visible text content
function scanVisibleContent() {
  const textNodes = document.evaluate(
    '//text()[not(ancestor::script)][not(ancestor::style)]',
    document,
    null,
    XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
    null
  );

  for (let i = 0; i < textNodes.snapshotLength; i++) {
    const node = textNodes.snapshotItem(i);
    processNode(node);
  }
}

// Scan HTML attributes
function scanAttributes() {
  const elements = document.querySelectorAll('a[href^="mailto:"], a[href^="tel:"], [data-email], [data-contact]');
  elements.forEach(element => {
    const mailtoHref = element.getAttribute('href');
    if (mailtoHref && mailtoHref.startsWith('mailto:')) {
      const email = mailtoHref.replace('mailto:', '').split('?')[0];
      processEmail(email);
    }
    
    const dataEmail = element.getAttribute('data-email');
    if (dataEmail) {
      processEmail(dataEmail);
    }
    
    const dataContact = element.getAttribute('data-contact');
    if (dataContact) {
      processText(dataContact);
    }
  });
}

// Scan for obfuscated emails
function scanObfuscatedEmails() {
  // Look for common email obfuscation patterns
  const elements = document.getElementsByTagName('*');
  for (const element of elements) {
    // Check for encoded email addresses
    const encodedEmail = element.getAttribute('data-encoded-email');
    if (encodedEmail) {
      try {
        const decodedEmail = atob(encodedEmail);
        if (decodedEmail.includes('@')) {
          processEmail(decodedEmail);
        }
      } catch (e) {
        // Ignore decoding errors
      }
    }
    
    // Check for email parts split across elements
    if (element.textContent.includes('@') || 
        element.textContent.includes(' at ') || 
        element.textContent.includes('[at]')) {
      const text = element.textContent;
      const emailMatches = text.match(patterns.email);
      if (emailMatches) {
        emailMatches.forEach(email => processEmail(email));
      }
    }
  }
}

// Process individual text nodes
function processNode(node) {
  const text = node.textContent.trim();
  if (!text) return;
  processText(text);
}

// Process text content
function processText(text) {
  // Clean up the text
  const cleanText = text.replace(/\s+/g, ' ')
                       .replace(/\[at\]/gi, '@')
                       .replace(/\s*\(\s*at\s*\)\s*/gi, '@')
                       .replace(/\s+at\s+/gi, '@')
                       .replace(/\s*\[dot\]\s*/gi, '.')
                       .replace(/\s*\(\s*dot\s*\)\s*/gi, '.')
                       .replace(/\s+dot\s+/gi, '.');

  // Extract contact information
  const emails = cleanText.match(patterns.email) || [];
  const phones = cleanText.match(patterns.phone) || [];
  
  // Process each email
  emails.forEach(email => processEmail(email));

  // Process each phone number
  phones.forEach(phone => {
    if (!processedPhones.has(phone)) {
      processedPhones.add(phone);
      const contact = {
        phone: phone,
        source: window.location.href
      };
      
      // Try to find associated information
      const surroundingText = getSurroundingText(phone);
      enrichContactData(contact, surroundingText);
      
      // Send to background script
      chrome.runtime.sendMessage({
        action: 'newContact',
        contact: contact
      });
    }
  });
}

// Process email addresses
function processEmail(email) {
  // Clean up the email
  email = email.trim()
               .toLowerCase()
               .replace(/\s+/g, '')
               .replace(/\[at\]/gi, '@')
               .replace(/\(at\)/gi, '@')
               .replace(/\s+at\s+/gi, '@')
               .replace(/\[dot\]/gi, '.')
               .replace(/\(dot\)/gi, '.')
               .replace(/\s+dot\s+/gi, '.');

  // Extract just the valid email pattern
  const emailMatch = email.match(/[\w.%+-]+@[\w.-]+\.[a-zA-Z]{2,}/);
  if (!emailMatch) return;
  email = emailMatch[0];
  
  // Skip if already processed
  if (processedEmails.has(email)) return;
  
  processedEmails.add(email);
  
  // Get the element containing this email
  const elements = Array.from(document.getElementsByTagName('*')).filter(el => 
    el.textContent.includes(email) && 
    !el.tagName.match(/^(SCRIPT|STYLE)$/i)
  );
  
  const container = elements[0];
  let parentContext = '';
  
  if (container) {
    // Get the parent element's content for better context
    const parent = container.parentElement;
    if (parent) {
      parentContext = parent.textContent;
    }
  }

  // Combine both contexts
  const surroundingText = getSurroundingText(email) + ' ' + parentContext;
  
  const contact = {
    email: email,
    source: window.location.href
  };

  // Enhanced contact data enrichment
  enrichContactData(contact, surroundingText);
  
  // Send to background script
  chrome.runtime.sendMessage({
    action: 'newContact',
    contact: contact
  });
}

// Get surrounding text for context
function getSurroundingText(searchText) {
  const range = 500; // Increased range for better context
  const allText = document.body.innerText;
  const index = allText.toLowerCase().indexOf(searchText.toLowerCase());
  if (index === -1) return '';
  
  // Get more context around the match
  const start = Math.max(0, index - range);
  const end = Math.min(allText.length, index + searchText.length + range);
  
  // Get the full lines containing the match
  let text = allText.substring(start, end);
  const lines = text.split('\n');
  const matchLine = lines.find(line => line.toLowerCase().includes(searchText.toLowerCase()));
  
  // Return the matching line plus surrounding lines
  const matchIndex = lines.indexOf(matchLine);
  const contextLines = lines.slice(Math.max(0, matchIndex - 2), Math.min(lines.length, matchIndex + 3));
  
  return contextLines.join('\n');
}

// Enrich contact data with additional information
function enrichContactData(contact, context) {
  // Try to find name - look for patterns before/after email
  const namePatterns = [
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)(?=\s+[\(<]?\s*(?:at|@))/,  // Name before email
    /(?<=@[\w.]+\s+)[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/,            // Name after email
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/                          // Any capitalized name
  ];

  for (const pattern of namePatterns) {
    const match = context.match(pattern);
    if (match) {
      contact.name = match[0].trim();
      break;
    }
  }

  // Try to find company - expanded patterns
  const companyPatterns = [
    // Standard company suffixes
    /([A-Z][A-Za-z0-9 &,.-]+(?:Inc|LLC|Ltd|Corporation|Corp|Company|Co|Group|Solutions|Technologies|Tech|Services))\.?/g,
    // Restaurant/Cafe names
    /([A-Z][A-Za-z0-9 &,.-]+(?:Restaurant|Cafe|Bistro|Grill|Bar|Eatery))s?\b/g,
    // General business names (capitalized words followed by business-related terms)
    /([A-Z][A-Za-z0-9 &,.-]+(?:Business|Enterprise|Agency|Studio|Associates|Partners))s?\b/g
  ];

  for (const pattern of companyPatterns) {
    const match = context.match(pattern);
    if (match) {
      contact.company = match[0].trim().replace(/\s+/g, ' ');
      break;
    }
  }

  // Try to find position/title - expanded list
  const titlePatterns = [
    // C-level and management
    /(?:CEO|CTO|CFO|COO|CIO|President|Vice President|VP|Director|Manager|Head of|Chief|Owner|Founder|Co-founder)/i,
    // Professional titles
    /(?:Software|Senior|Lead|Principal|Staff|Technical|Project|Product|Program|Marketing|Sales|Business|Operations|Customer|Account|Support)\s+(?:Engineer|Developer|Designer|Architect|Consultant|Manager|Representative|Specialist|Analyst|Coordinator|Associate)/i,
    // General professional roles
    /(?:Engineer|Developer|Designer|Architect|Consultant|Administrator|Supervisor|Coordinator|Specialist|Agent|Representative|Advisor)/i
  ];

  for (const pattern of titlePatterns) {
    const match = context.match(pattern);
    if (match) {
      contact.position = match[0].trim();
      break;
    }
  }

  // Try to find phone numbers - enhanced pattern
  const phonePatterns = [
    /(?:(?:\+\d{1,3}[-. ]?)?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4})/g,  // Standard format
    /(?:(?:\+\d{1,3}[-. ]?)?\d{3}[-. ]?\d{3}[-. ]?\d{4})/g,        // Without parentheses
    /(?:\d{3}[-. ]?\d{4})/g                                         // Local format
  ];

  for (const pattern of phonePatterns) {
    const match = context.match(pattern);
    if (match) {
      contact.phone = match[0].replace(/[^\d+]/g, '').replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');
      break;
    }
  }

  // Try to find address - enhanced patterns
  const addressPatterns = [
    // Full US address
    /\d+[A-Za-z0-9\s,.-]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Circle|Cir|Way|Place|Pl|Square|Sq)[,\s]+[A-Za-z\s]+,\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?/i,
    // Street address only
    /\d+[A-Za-z0-9\s,.-]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Circle|Cir|Way|Place|Pl|Square|Sq)/i,
    // City, State ZIP
    /[A-Za-z\s]+,\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?/
  ];

  for (const pattern of addressPatterns) {
    const match = context.match(pattern);
    if (match) {
      contact.address = match[0].trim().replace(/\s+/g, ' ');
      break;
    }
  }

  // Try to find LinkedIn profile - enhanced pattern
  const linkedinPatterns = [
    /https?:\/\/(?:www\.)?linkedin\.com\/(?:in|company)\/[A-Za-z0-9-]+(?:\/[A-Za-z0-9-]+)?/i,
    /linkedin\.com\/(?:in|company)\/[A-Za-z0-9-]+/i
  ];

  for (const pattern of linkedinPatterns) {
    const match = context.match(pattern);
    if (match) {
      contact.linkedin = match[0].trim();
      break;
    }
  }

  // Try to find website
  const websitePattern = /https?:\/\/(?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s<>]*)?/i;
  const websiteMatch = context.match(websitePattern);
  if (websiteMatch && !websiteMatch[0].includes('linkedin.com')) {
    contact.website = websiteMatch[0].trim();
  }
}

// Process structured data (JSON-LD)
function scanStructuredData() {
  const jsonLdElements = document.querySelectorAll('script[type="application/ld+json"]');
  jsonLdElements.forEach(element => {
    try {
      const data = JSON.parse(element.textContent);
      processStructuredData(data);
    } catch (e) {
      console.error('Error parsing JSON-LD:', e);
    }
  });
}

// Process structured data
function processStructuredData(data) {
  if (Array.isArray(data)) {
    data.forEach(item => processStructuredData(item));
    return;
  }

  if (typeof data !== 'object' || !data) return;

  if (data['@type'] === 'Person' || data['@type'] === 'Organization') {
    const contact = {
      source: window.location.href
    };

    if (data.name) contact.name = data.name;
    if (data.email) processEmail(data.email);
    if (data.telephone) contact.phone = data.telephone;
    if (data.address) {
      contact.address = typeof data.address === 'object' 
        ? `${data.address.streetAddress}, ${data.address.addressLocality}, ${data.address.addressRegion} ${data.address.postalCode}`
        : data.address;
    }
    if (data.jobTitle) contact.position = data.jobTitle;
    if (data.worksFor && data.worksFor.name) contact.company = data.worksFor.name;

    if (Object.keys(contact).length > 1) {
      chrome.runtime.sendMessage({
        action: 'newContact',
        contact: contact
      });
    }
  }

  Object.values(data).forEach(value => {
    if (typeof value === 'object' && value !== null) {
      processStructuredData(value);
    }
  });
}

// Process meta tags
function scanMetaTags() {
  const metaTags = document.querySelectorAll('meta[property^="og:"], meta[name^="twitter:"], meta[name^="author"], meta[name^="contact"]');
  metaTags.forEach(tag => {
    const content = tag.getAttribute('content');
    if (content) {
      processText(content);
    }
  });
}

// Set up mutation observer to detect dynamic content
const observer = new MutationObserver((mutations) => {
  if (isScrapingActive) {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const textNodes = document.evaluate(
            './/text()[not(ancestor::script)][not(ancestor::style)]',
            node,
            null,
            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
            null
          );
          
          for (let i = 0; i < textNodes.snapshotLength; i++) {
            processNode(textNodes.snapshotItem(i));
          }
        }
      });
    });
  }
});

// Start observing
observer.observe(document.body, {
  childList: true,
  subtree: true
});

// Initial scan
chrome.storage.local.get(['isActive'], (result) => {
  isScrapingActive = result.isActive || false;
  if (isScrapingActive) {
    scanPage();
  }
}); 