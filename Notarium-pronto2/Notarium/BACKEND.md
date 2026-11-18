# Notarium backend

The backend uses only Node.js built-ins. From the repository root, run:

```powershell
node server.js
```

By default it listens on `http://127.0.0.1:3000`, serves the repository frontend, and stores its private JSON database and uploaded files under `notarium-data\`. Set `PORT`, `HOST`, or `NOTARIUM_DATA_DIR` to override those defaults. Use Node.js 18 or newer.

There are no default accounts or passwords. The first user opens the app, checks `GET /api/setup`, then creates the sole teacher account with `POST /api/auth/bootstrap`. Later users sign in with `POST /api/auth/login`. Both return a bearer token; authenticated requests must send `Authorization: Bearer <token>`. Passwords are stored as salted scrypt hashes, and persisted session tokens are stored as digests.

## Production build

Run `npm run build` to generate a static deployment in `dist\`. The build includes the current frontend files and leaves the source `index.html` unchanged. To use a separately hosted API, set `NOTARIUM_API_URL` before building; the value must be an absolute HTTP or HTTPS URL. When unset, the frontend uses the same origin as the static site.

Run the build tests with `node --test build.test.js`.

## Routes used by the frontend

| Method and route | Access | Purpose |
| --- | --- | --- |
| `GET /api/setup` | Public | Returns `{ teacherExists }`. |
| `POST /api/auth/bootstrap` | Public, first teacher only | Body `{ name, username, password }`; returns `{ token, user, model, portalUrl }`. |
| `POST /api/auth/login` | Public | Body `{ username, password }`; returns the same session shape. |
| `GET /api/auth/session` | Authenticated | Validates the saved bearer token and returns `{ user, model }` to restore the current session. |
| `POST /api/auth/logout` | Authenticated | Revokes the bearer token. |
| `GET /api/model` | Authenticated | Returns `{ model }`; students receive published content, playlists containing visible exercise blocks, access-lock state, and their own attempts. Locked lesson content and exercise questions are omitted. |
| `PUT /api/model` | Teacher | Body `{ model }`; saves course content, including playlists and their `exerciseBlocks[].playlistId` membership, and emits notifications for newly published or newly released lessons/exercises. |
| `GET /api/progress` | Student | Returns the signed-in student's own completed lesson and exercise history. |
| `PUT /api/progress/lesson/:id` | Student | Body `{ completed: boolean }`; marks an accessible published lesson complete or removes that completion. |
| `PUT /api/progress/exercise/:id` | Student | Body `{ completed: boolean }`; marks an accessible published non-assessment exercise complete or removes that completion. |
| `POST /api/students` | Teacher | Body `{ name, username, password }`; returns `{ student, portalUrl }`. |
| `GET /api/students` | Teacher | Returns `{ students }` with presence information. |
| `DELETE /api/students/:id` | Teacher | Removes the student, sessions, attempts, notifications, and their uploaded files. |
| `POST /api/media` | Authenticated | Body `{ id, name, type?, dataUrl }`; returns media metadata. |
| `GET /api/media/:id` | Authenticated | Streams a permitted uploaded media type. |
| `POST /api/practice/request` | Student | Body `{ lessonId }`; returns a personalized `{ exercise }` from published lesson questions. |
| `POST /api/attempts` | Student | Body `{ attempt }`; records a submission and notifies the teacher. |
| `POST /api/attempts/:id/review` | Teacher | Body `{ teacherRating, teacherNote }`; reviews a submission and notifies its student. |
| `POST /api/exams/:id/open` | Student | Returns exam/session details, or `notReleased`/`locked` state. |
| `POST /api/exams/:id/start` | Student | Starts the assessment timer. |
| `POST /api/exams/:id/heartbeat` | Student | Refreshes the assessment session; locks after three minutes idle when `assessment.lockOnExit` is enabled. |
| `POST /api/exams/:id/request-reopen` | Student | Body `{ reason }`; asks the teacher to unlock a locked assessment. |
| `POST /api/exams/unlock` | Teacher | Body `{ examId, studentId }`; resets the student's assessment session. |
| `GET /api/notifications` | Authenticated | Returns the current user's notifications. |
| `POST /api/notifications/:id/read` | Authenticated | Marks that user's notification read. |
| `POST /api/presence` | Authenticated | Updates last-seen presence. |
| `PUT /api/account/profile` | Authenticated | Body `{ name, username }`; updates the account profile. |

The server installs the bundled MusicXML score and rhythmic-reading sample exercise from `seed-media.js` and `seed-catalog.js` on startup. Seeding is idempotent and preserves existing model data. The score is available to authenticated teacher and student accounts; the sample exercise is published to students.

JSON errors have the shape `{ error }`. The service validates identifiers and request shapes, limits request/media sizes, rejects unsafe media types, and uses generated disk filenames rather than client-supplied paths.

Lessons, exercises, and their parent blocks can use `releaseMode: "selected"` with `releasedStudentIds` to restrict access to selected student account IDs. A selected lesson or activity release can override a locked parent block for that item. Existing content without release settings remains available to all students. The server enforces these restrictions when returning content and accepting practice requests, answers, and assessments.

Playlists are stored in `model.playlists`; each exercise block can belong to one playlist through `playlistId`, and exercises remain in their exercise block through `exerciseBlockId`. Playlist color and center symbol are presentation metadata. Student completion records are stored separately from teacher-owned course content and are keyed to the authenticated student account, so one student's history cannot overwrite another's.

Run focused backend verification with:

```powershell
node --test server.test.js
```
