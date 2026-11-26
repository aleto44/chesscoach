' Starts Chess Coach with no console window: runs start-dev.ps1 hidden (window style 0) and
' returns at once. The desktop shortcut points here. Errors show as a message box, and the
' console output is still kept in dev-console.log.
Set fso = CreateObject("Scripting.FileSystemObject")
script = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "start-dev.ps1")
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & script & """ -Hidden", 0, False
