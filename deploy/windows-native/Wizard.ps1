function Show-SetupWizard {
    param([long]$InstallerWindowHandle = 0)
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    if (-not ('SiloNR.SetupWindowOwner' -as [type])) {
        Add-Type -ReferencedAssemblies System.Windows.Forms.dll -TypeDefinition @'
using System;
using System.Windows.Forms;
namespace SiloNR {
    public sealed class SetupWindowOwner : IWin32Window {
        public IntPtr Handle { get; private set; }
        public SetupWindowOwner(long handle) { Handle = new IntPtr(handle); }
    }
}
'@
    }
    $form = New-Object Windows.Forms.Form
    $form.Text = 'SiloNR - primeira instalacao'
    $form.ClientSize = New-Object Drawing.Size(720, 590)
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.ShowInTaskbar = $true
    $form.Font = New-Object Drawing.Font('Segoe UI', 10)
    $fields = @{}
    $definitions = @(
        @('ServerAddress', 'IP reservado do servidor', ''),
        @('BackupPath', 'Pasta de backup (disco externo recomendado)', 'C:\SiloNRBackups'),
        @('LicenseServiceUrl', 'URL Supabase /functions/v1', ''),
        @('LicenseClientApiKey', 'LICENSE_CLIENT_API_KEY', ''),
        @('LicenseSigningPublicKey', 'LICENSE_SIGNING_PUBLIC_KEY', ''),
        @('AdminName', 'Nome do administrador', ''),
        @('AdminEmail', 'E-mail do administrador', ''),
        @('AdminPassword', 'Senha inicial (12 ou mais caracteres)', ''),
        @('Organization', 'Empresa', ''),
        @('Facility', 'Unidade', '')
    )
    $y = 20
    foreach ($definition in $definitions) {
        $label = New-Object Windows.Forms.Label
        $label.Text = $definition[1]; $label.Location = New-Object Drawing.Point(18,$y); $label.Size = New-Object Drawing.Size(320,22)
        $box = New-Object Windows.Forms.TextBox
        $box.Name = $definition[0]
        $box.AccessibleName = $definition[1]
        $box.Location = New-Object Drawing.Point(342,($y-2)); $box.Size = New-Object Drawing.Size(354,25)
        $box.Text = $definition[2]; $box.UseSystemPasswordChar = $definition[0] -in @('AdminPassword','LicenseClientApiKey')
        $fields[$definition[0]] = $box
        $form.Controls.AddRange(@($label,$box)); $y += 43
    }
    $hint = New-Object Windows.Forms.Label
    $hint.Text = 'Nao informe chaves Asaas, service_role ou chave privada. Os dados ficam neste PC.'
    $hint.Location = New-Object Drawing.Point(18,460); $hint.Size = New-Object Drawing.Size(680,45)
    $form.Controls.Add($hint)
    $button = New-Object Windows.Forms.Button
    $button.Text = 'Configurar servidor'; $button.Size = New-Object Drawing.Size(180,40); $button.Location = New-Object Drawing.Point(515,530)
    $button.Add_Click({
        $configuration = @{}
        foreach ($key in $fields.Keys) { $configuration[$key] = $fields[$key].Text.Trim() }
        $configuration.AdminPassword = $fields.AdminPassword.Text
        try { Assert-Configuration $configuration } catch { [void][Windows.Forms.MessageBox]::Show($form, $_.Exception.Message, 'Verifique os campos'); return }
        $form.Tag = $configuration
        $form.DialogResult = [Windows.Forms.DialogResult]::OK
        $form.Close()
    })
    $form.Controls.Add($button)
    $form.AcceptButton = $button
    # The installer owns the dialog; briefly raise it without keeping it above
    # the user's password manager or other applications during data entry.
    $form.Add_Shown({
        $form.TopMost = $true
        $form.BringToFront()
        $form.Activate()
        $form.TopMost = $false
        [void]$fields.ServerAddress.Focus()
    })
    try {
        if ($InstallerWindowHandle -ne 0) {
            $owner = [SiloNR.SetupWindowOwner]::new($InstallerWindowHandle)
            $result = $form.ShowDialog($owner)
        } else { $result = $form.ShowDialog() }
        if ($result -ne [Windows.Forms.DialogResult]::OK) { throw 'Configuracao cancelada; execute o instalador novamente para concluir.' }
        return $form.Tag
    } finally { $form.Dispose() }
}
