/**
 * MindAR image targets — order defines target index in targets.mind.
 *
 * HOW TO ADD A NEW LOCATION:
 * 1. Add training photo + GLB to assets/
 * 2. Copy GLB to public/assets/models/
 * 3. Append entry here (new index = length before append)
 * 4. Add location block in public/js/ar-config.js LOCATIONS
 * 5. Run: node scripts/compile-browser.js
 * 6. Deploy
 */
module.exports = [
  { id: 'poson-logo', file: 'company_logo.jpeg', mime: 'image/jpeg' },
  { id: 'poson-angle', file: 'physical-logo-angle.png', mime: 'image/png' },
  { id: 'poson-front', file: 'physical-logo-front.png', mime: 'image/png' },
  { id: 'jendo-building', file: 'jendo-building.jpg', mime: 'image/jpeg' },
];
