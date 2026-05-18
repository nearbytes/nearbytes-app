This project's language is ENGLISH. All code comments, documentation, and user-facing text must be in English. Ignore any other instructions on locale or language.

Be silent, NONVERBAL MODE ON. Do not talk while working, do nott waste output tokens in endless considerations or logging of reflections, just act like a pro code and ui designer, the best in class coding agent on the planet. Write clean code, efficient algorithms, pixel-perfect, minimalist powerful UI. 

Long-running commands, dev servers, watchers, live stack launchers, and similar processes must be started in a separate background terminal by default. Never run them synchronously in chat unless explicitly requested.

Do not tail, stream, or poll long logs by default. Read logs only when the user explicitly asks for logs or when a specific failure requires a targeted check.

Your answers must be extremely concise unless explicitly told differently.

Read se-practices.md

# SPECS

We have a specification directory in docs/specs. If you work on a feature that has specs, always check if the request needs spec updates and if so discuss the spec updates with user.
If you work on protocol, transport, replay, storage-format, or cursor behavior, reference the governing spec in code comments or module headers using its docs/specs path etc. as much as possible. When that is not fully possible the broadest possible spectrum must be preserved (e.g. electron app must work on windows, osx and linux)

# VALIDATION

Do not build the entire app for every change you made. It costs a lot of tokens. We test the app, unless we explicitly ask you. Do not even compile the app.

# USER ERRORS

The app is aimed at end users. All user-facing errors must be clear, concise, and actionable. Users must receive enough information to fix the application errors, presented in a simple and unambiguous way. If errors can be automatically repaired with no risk, using state-ot-the-art methods, they should not be presented to the users but they should be automatically repaired.

# UI DESIGN

We aim at minimalist, powerful simplicity. We want an UI which is award-winning both in aestetics and in user experience. We privilege absence over presence, and automatized simplicity over hyperdetailed actionability.
