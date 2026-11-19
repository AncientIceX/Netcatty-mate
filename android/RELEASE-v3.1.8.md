# Netcatty Mate v3.1.8

- Phone widths below 768px present terminal tool panels as temporary overlay drawers (up to 360px / 88% of the terminal layer), without squeezing or resizing the terminal. Tablet/desktop retain resizable split panes and stored width/dock preferences.
- Script library and running-task views keep an explicit accessible close button, backdrop dismiss, keyboard Escape/focus containment, and Android hardware-back dismissal before leaving the terminal.
- Script toolbars wrap on phones, footer actions have 44px touch targets, long script names retain accessible full titles. Selecting/running behavior is unchanged; no script is executed by responsive layout changes.
- Production-dist browser regression covers synthetic script fixtures at 320/375/390px, landscape, tablet and desktop, dark/light, rotation, large font, close/back/backdrop and terminal width invariance. Existing privacy, encrypted protective backup, cloud restore-only, native SFTP and signing gates retained.

Validation is browser/CI and isolated native integration, not a physical Android-device test. Real AI-provider UI/send verification remains explicitly skipped; no provider secrets are required for this UI repair.
