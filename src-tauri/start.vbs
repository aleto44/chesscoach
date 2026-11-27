' Starts Chess Coach with no console window: runs launch.ps1 (next to this file) hidden, which
' updates the program if a new one is deployed and starts it. The desktop shortcut points here.
Set fso = CreateObject("Scripting.FileSystemObject")
script = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "launch.ps1")
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & script & """", 0, False
