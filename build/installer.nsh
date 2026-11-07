; Nexura DJ Studio — personalización del instalador NSIS (electron-builder la incluye automáticamente)
; Mensaje de agradecimiento al terminar la instalación (no se muestra en instalaciones silenciosas /S).
!macro customInstall
  IfSilent +2
    MessageBox MB_OK|MB_ICONINFORMATION "Gracias por usar Nexura DJ Studio.$\r$\n$\r$\nEsto es una demo, agradecemos nos envíes tus sugerencias."
!macroend
