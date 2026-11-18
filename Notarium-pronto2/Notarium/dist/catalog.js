export const catalog = {
  schemaVersion: 1,
  profile: {
    displayName: 'Músico',
    username: '',
    role: 'teacher',
    theme: 'light'
  },
  blocks: [],
  lessons: [],
  exercises: [],
  attempts: []
};

export const catalogItems = [
  {
    id: 'lessons',
    title: 'Aulas de música',
    description: 'Explore os conteúdos publicados e continue aprendendo no seu ritmo.',
    icon: '𝄞',
    action: 'go-lessons',
    actionLabel: 'Explorar aulas'
  },
  {
    id: 'exercises',
    title: 'Exercícios práticos',
    description: 'Pratique o que aprendeu e acompanhe sua evolução musical.',
    icon: '♫',
    action: 'go-exercises',
    actionLabel: 'Ver exercícios'
  },
  {
    id: 'score-demo',
    title: 'Partitura sem título',
    description: 'Baixe uma partitura de demonstração em formato MusicXML compactado (.mxl).',
    icon: '𝄞',
    action: 'download-catalog-media',
    actionLabel: 'Baixar partitura',
    mediaId: 'c61679b6-f189-400a-8b47-1c33c11b7db9',
    mediaType: 'application/vnd.recordare.musicxml'
  }
];
