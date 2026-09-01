#Requires -Version 5.1
$ErrorActionPreference='Stop'
$principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Start-Process "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -Verb RunAs -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $PSCommandPath)
    exit
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form=New-Object Windows.Forms.Form
$form.Text='SiloNR - administrar servidor'
$form.ClientSize=New-Object Drawing.Size(420,250)
$form.StartPosition='CenterScreen'
$actions=@('Backup agora','Restaurar backup','Gerar diagnostico','Conectar outros PCs')
$y=20
foreach ($label in $actions) {
    $button=New-Object Windows.Forms.Button
    $button.Text=$label; $button.Size=New-Object Drawing.Size(360,40); $button.Location=New-Object Drawing.Point(30,$y)
    $button.Add_Click({
        param($sender)
        try {
            switch ($sender.Text) {
                'Backup agora' { & (Join-Path $PSScriptRoot 'Maintenance.ps1') -Action Backup }
                'Gerar diagnostico' { & (Join-Path $PSScriptRoot 'Maintenance.ps1') -Action Diagnostics }
                'Conectar outros PCs' { Start-Process explorer.exe (Join-Path $env:ProgramData 'SiloNR\conectar-outros-pcs'); return }
                'Restaurar backup' {
                    $dialog=New-Object Windows.Forms.FolderBrowserDialog
                    $dialog.Description='Selecione a pasta de backup nativo do SiloNR'
                    if ($dialog.ShowDialog() -ne 'OK') { return }
                    $choice=[Windows.Forms.MessageBox]::Show('Isto substitui os dados atuais. Sera criado um backup de seguranca. Continuar?', 'Confirmar restauracao', 'YesNo', 'Warning')
                    if ($choice -ne 'Yes') { return }
                    & (Join-Path $PSScriptRoot 'Maintenance.ps1') -Action Restore -BackupPath $dialog.SelectedPath -Confirmation RESTORE_SILONR_WINDOWS
                }
            }
            [void][Windows.Forms.MessageBox]::Show('Operacao concluida.', 'SiloNR')
        } catch { [void][Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Operacao nao concluida') }
    })
    $form.Controls.Add($button); $y+=52
}
[void]$form.ShowDialog()
