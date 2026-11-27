Spoiler photos for the room pages go in this folder.
Name them like sherlock-1.jpg, sherlock-2.jpg, christmas-1.jpg ... (about 1200px wide is plenty).
Then list them in src/routes/index.tsx under that room's `spoilers`, e.g.
  spoilers: [{ src: '/images/spoilers/sherlock-1.jpg', caption: 'The study' }, ...]
