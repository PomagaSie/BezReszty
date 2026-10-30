// Editorial assets supplied by the organizer, keyed by the campaign's stable slug.
const galleries = new Map([
  ['szkatulka-bajek-w-google-play', [
    { file: 'home.png', alt: 'Szkatułka Bajek — ekran główny z wyborem nastroju' },
    { file: 'discovery.png', alt: 'Szkatułka Bajek — wylosowana bajka' },
    { file: 'player.png', alt: 'Szkatułka Bajek — odtwarzacz i klucz snu' },
    { file: 'library.png', alt: 'Szkatułka Bajek — biblioteka pobranych bajek' },
  ].map(({ file, alt }) => ({ src: `/assets/images/szkatulka-bajek/${file}`, alt }))],
]);

export const campaignMedia = campaign => galleries.get(campaign.slug) || [];
