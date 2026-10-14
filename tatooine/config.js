window.TATOOINE_CONFIG = Object.freeze({
  version: 'v1.11.8 CACHE-SAFE HIDDEN HUB ACTIONS',
  apiUrl: 'https://script.google.com/macros/s/AKfycbx9XlQG6kCvWVU6OekcWAmHAVnjFXfG-_UD_pKQrQqYaWNyHzmXsmB_2LGohxETrrfTpA/exec',
  venue: 'tatooine',
  restaurantName: 'Tatooine',
  reportLocation: 'ПЕТРОВКА',
  defaultChangeFund: 100000,
  maxOcrPages: 20,
  maxOcrImageBytes: 6 * 1024 * 1024,
  maxOcrTotalBytes: 12 * 1024 * 1024
});

// Telegram can retain a previous hub HTML while refreshing this config.
// Keep restricted hub actions hidden in that mixed-cache state; routes remain intact.
(function hideRestrictedHubActions() {
  const styleId = 'tatooine-restricted-hub-actions';
  if (document.getElementById(styleId)) return;
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = '#openTaxi,#openRoleManagement,#openRideOriginSettings{display:none!important}';
  document.head.appendChild(style);
}());
