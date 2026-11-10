; Nexura DJ Studio — personalización del instalador NSIS (electron-builder la incluye automáticamente)
; Mensaje de agradecimiento al terminar la instalación (no se muestra en instalaciones silenciosas /S).
!macro customInstall
  IfSilent +2
    MessageBox MB_OK|MB_ICONINFORMATION "Gracias por instalar Nexura DJ Studio.$\r$\n$\r$\nSi encuentras un error o tienes una idea, envíanosla con el botón ? (Ayuda) → «Enviar informe o sugerencia»."
!macroend
