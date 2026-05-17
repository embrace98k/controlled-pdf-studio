; 自定义 NSIS 安装脚本
; 让桌面/开始菜单快捷方式强制使用 resources/icon.ico
; （因为 signAndEditExecutable=false 导致 .exe 自身没有嵌入图标）

!macro customInstall
  ; 删除 electron-builder 默认生成的快捷方式（图标是 Electron 黑原子）
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\$StartMenuGroup\${PRODUCT_NAME}.lnk"

  ; 重建快捷方式，icon 显式指向 resources\icon.ico
  CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_FILENAME}.exe" "" "$INSTDIR\resources\icon.ico" 0
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_FILENAME}.exe" "" "$INSTDIR\resources\icon.ico" 0
!macroend

!macro customUnInstall
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\$StartMenuGroup\${PRODUCT_NAME}.lnk"
!macroend
