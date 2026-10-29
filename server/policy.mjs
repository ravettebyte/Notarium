export function canAccess(item, user) {
  return user.role === 'teacher' || (item.published === true
    && (!item.personalizedFor || item.personalizedFor === user.id)
    && (!Array.isArray(item.studentIds) || !item.studentIds.length || item.studentIds.includes(user.id)));
}
export function stripAnswers(question) {
  const safe = { ...question };
  for (const key of ['answer', 'acceptedAnswers', 'expectedNotes', 'expectedIntervals', 'assemblyOrder', 'referenceNotes', 'feedback']) delete safe[key];
  return safe;
}
export function validateProfile(body) {
  const avatarDataUrl = String(body.avatarDataUrl || '');
  if (avatarDataUrl && (!/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(avatarDataUrl) || avatarDataUrl.length > 300000)) throw Object.assign(new Error('Foto inválida.'), { status: 400 });
  return { bio: String(body.bio || '').slice(0, 1000), avatarDataUrl, defaultOctave: Math.min(8, Math.max(-1, Number(body.defaultOctave) || 4)) };
}
