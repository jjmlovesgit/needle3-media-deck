using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Media Deck Setup")]
[assembly: AssemblyProduct("Media Deck")]
[assembly: AssemblyCompany("Media Deck")]
[assembly: AssemblyDescription("Installs the Media Deck local companion and Chrome extension payload.")]
[assembly: AssemblyVersion("0.1.0.0")]
[assembly: AssemblyFileVersion("0.1.0.0")]

namespace MediaDeckSetup
{
    internal static class Program
    {
        internal const string ProductName = "Media Deck";
        internal const string StableExtensionId = "chophfbioppiikhicgkkhingjdhcejdl";
        internal const string PayloadResourceName = "MediaDeck.Payload.zip";

        [STAThread]
        private static int Main(string[] args)
        {
            if (HasArgument(args, "/verify") || HasArgument(args, "--verify"))
            {
                return InstallerEngine.VerifyPackage();
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            if (HasArgument(args, "/uninstall") || HasArgument(args, "--uninstall"))
            {
                return InstallerEngine.RunUninstallInteractive();
            }

            Application.Run(new InstallerForm());
            return 0;
        }

        private static bool HasArgument(string[] args, string expected)
        {
            foreach (string value in args)
            {
                if (string.Equals(value, expected, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }

            return false;
        }
    }

    internal sealed class InstallerForm : Form
    {
        private readonly Label stageLabel;
        private readonly Label messageLabel;
        private readonly Label percentLabel;
        private readonly ProgressBar progressBar;
        private readonly RichTextBox logBox;
        private readonly Button installButton;
        private readonly Button chromeButton;
        private readonly Button closeButton;
        private bool installing;
        private string installedExtensionPath;

        internal InstallerForm()
        {
            Text = "Media Deck Setup";
            Width = 760;
            Height = 720;
            MinimumSize = new Size(760, 700);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(5, 10, 11);
            ForeColor = Color.WhiteSmoke;
            Font = new Font("Segoe UI", 9F);

            Panel header = new Panel();
            header.Dock = DockStyle.Top;
            header.Height = 138;
            header.BackColor = Color.FromArgb(10, 22, 24);
            Controls.Add(header);

            Label eyebrow = new Label();
            eyebrow.Text = "LOCAL AUDIOPHILE MEDIA SYSTEM";
            eyebrow.ForeColor = Color.FromArgb(90, 210, 225);
            eyebrow.Font = new Font("Consolas", 9F, FontStyle.Bold);
            eyebrow.AutoSize = true;
            eyebrow.Location = new Point(30, 24);
            header.Controls.Add(eyebrow);

            Label title = new Label();
            title.Text = "MEDIA DECK";
            title.ForeColor = Color.FromArgb(22, 217, 255);
            title.Font = new Font("Segoe UI", 29F, FontStyle.Bold);
            title.AutoSize = true;
            title.Location = new Point(25, 45);
            header.Controls.Add(title);

            Label subtitle = new Label();
            subtitle.Text = "Windows companion and Chrome extension setup";
            subtitle.ForeColor = Color.FromArgb(175, 198, 201);
            subtitle.Font = new Font("Segoe UI", 10F);
            subtitle.AutoSize = true;
            subtitle.Location = new Point(31, 102);
            header.Controls.Add(subtitle);

            Label badge = new Label();
            badge.Text = "CPU · LOCAL · PRIVATE";
            badge.ForeColor = Color.FromArgb(25, 242, 139);
            badge.BackColor = Color.FromArgb(8, 33, 26);
            badge.BorderStyle = BorderStyle.FixedSingle;
            badge.Font = new Font("Consolas", 9F, FontStyle.Bold);
            badge.TextAlign = ContentAlignment.MiddleCenter;
            badge.Size = new Size(180, 34);
            badge.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            badge.Location = new Point(540, 50);
            header.Controls.Add(badge);

            Panel content = new Panel();
            content.Dock = DockStyle.Fill;
            content.Padding = new Padding(28, 22, 28, 16);
            content.BackColor = Color.FromArgb(5, 10, 11);
            Controls.Add(content);
            header.BringToFront();

            stageLabel = new Label();
            stageLabel.Text = "Ready to install";
            stageLabel.ForeColor = Color.White;
            stageLabel.Font = new Font("Segoe UI", 18F, FontStyle.Bold);
            stageLabel.AutoSize = true;
            stageLabel.Location = new Point(28, 22);
            content.Controls.Add(stageLabel);

            messageLabel = new Label();
            messageLabel.Text = "Installs Media Deck for the current Windows user and registers its local Chrome bridge.";
            messageLabel.ForeColor = Color.FromArgb(170, 193, 196);
            messageLabel.Font = new Font("Segoe UI", 10F);
            messageLabel.Location = new Point(31, 64);
            messageLabel.Size = new Size(650, 48);
            content.Controls.Add(messageLabel);

            progressBar = new ProgressBar();
            progressBar.Location = new Point(32, 116);
            progressBar.Size = new Size(620, 18);
            progressBar.Minimum = 0;
            progressBar.Maximum = 100;
            progressBar.Style = ProgressBarStyle.Continuous;
            progressBar.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            content.Controls.Add(progressBar);

            percentLabel = new Label();
            percentLabel.Text = "0%";
            percentLabel.ForeColor = Color.FromArgb(22, 217, 255);
            percentLabel.Font = new Font("Consolas", 10F, FontStyle.Bold);
            percentLabel.AutoSize = true;
            percentLabel.Location = new Point(665, 114);
            percentLabel.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            content.Controls.Add(percentLabel);

            Label detailHeading = new Label();
            detailHeading.Text = "INSTALLATION LOG";
            detailHeading.ForeColor = Color.FromArgb(90, 210, 225);
            detailHeading.Font = new Font("Consolas", 9F, FontStyle.Bold);
            detailHeading.AutoSize = true;
            detailHeading.Location = new Point(31, 159);
            content.Controls.Add(detailHeading);

            logBox = new RichTextBox();
            logBox.Location = new Point(32, 184);
            logBox.Size = new Size(668, 220);
            logBox.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            logBox.BackColor = Color.FromArgb(1, 8, 9);
            logBox.ForeColor = Color.FromArgb(148, 225, 226);
            logBox.BorderStyle = BorderStyle.FixedSingle;
            logBox.Font = new Font("Consolas", 9F);
            logBox.ReadOnly = true;
            logBox.DetectUrls = false;
            content.Controls.Add(logBox);

            Label note = new Label();
            note.Text = "Requires Chrome, Python, Node.js, FFmpeg, and FFprobe. No CUDA or GPU runtime is required.";
            note.ForeColor = Color.FromArgb(182, 190, 170);
            note.Font = new Font("Segoe UI", 9F);
            note.Location = new Point(32, 414);
            note.Size = new Size(668, 36);
            note.Anchor = AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            content.Controls.Add(note);

            FlowLayoutPanel buttons = new FlowLayoutPanel();
            buttons.FlowDirection = FlowDirection.RightToLeft;
            buttons.WrapContents = false;
            buttons.Location = new Point(32, 458);
            buttons.Size = new Size(668, 44);
            buttons.Anchor = AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            content.Controls.Add(buttons);

            closeButton = CreateButton("Close", Color.FromArgb(31, 43, 44), Color.WhiteSmoke, 110);
            closeButton.Click += CloseButtonClick;
            buttons.Controls.Add(closeButton);

            installButton = CreateButton("Install", Color.FromArgb(8, 125, 161), Color.White, 130);
            installButton.Click += InstallButtonClick;
            buttons.Controls.Add(installButton);

            chromeButton = CreateButton("Open Chrome Setup", Color.FromArgb(10, 72, 77), Color.FromArgb(22, 217, 255), 170);
            chromeButton.Enabled = false;
            chromeButton.Click += ChromeButtonClick;
            buttons.Controls.Add(chromeButton);

            AppendLog("Installer ready.");
            AppendLog("Target: " + InstallerEngine.InstallRoot);
        }

        private static Button CreateButton(string text, Color backColor, Color foreColor, int width)
        {
            Button button = new Button();
            button.Text = text;
            button.Width = width;
            button.Height = 38;
            button.Margin = new Padding(8, 0, 0, 0);
            button.FlatStyle = FlatStyle.Flat;
            button.FlatAppearance.BorderColor = Color.FromArgb(52, 90, 93);
            button.FlatAppearance.BorderSize = 1;
            button.BackColor = backColor;
            button.ForeColor = foreColor;
            button.Font = new Font("Segoe UI", 9F, FontStyle.Bold);
            return button;
        }

        private async void InstallButtonClick(object sender, EventArgs e)
        {
            if (installing)
            {
                return;
            }

            installing = true;
            installButton.Enabled = false;
            chromeButton.Enabled = false;
            closeButton.Enabled = false;
            SetProgress("Checking system", "Validating required Windows tools and the embedded Media Deck payload.", 2, false);

            try
            {
                InstallResult result = await Task.Run(delegate
                {
                    return InstallerEngine.Install(
                        delegate(string stage, string message, int percent, bool indeterminate)
                        {
                            BeginInvoke(new Action(delegate { SetProgress(stage, message, percent, indeterminate); }));
                        },
                        delegate(string line)
                        {
                            BeginInvoke(new Action(delegate { AppendLog(line); }));
                        });
                });

                installedExtensionPath = result.ExtensionPath;
                SetProgress("Installation complete", "Media Deck is installed. Load the displayed extension folder in Chrome to finish setup.", 100, false);
                AppendLog("Installed companion: " + result.InstallRoot);
                AppendLog("Chrome extension: " + result.ExtensionPath);
                installButton.Text = "Repair";
                chromeButton.Enabled = true;
                closeButton.Text = "Finish";
            }
            catch (Exception ex)
            {
                SetProgress("Installation failed", ex.Message, progressBar.Value, false);
                AppendLog("ERROR: " + ex.Message);
                installButton.Text = "Try Again";
            }
            finally
            {
                installing = false;
                installButton.Enabled = true;
                closeButton.Enabled = true;
            }
        }

        private void ChromeButtonClick(object sender, EventArgs e)
        {
            if (string.IsNullOrWhiteSpace(installedExtensionPath))
            {
                installedExtensionPath = Path.Combine(InstallerEngine.InstallRoot, "extension");
            }

            try
            {
                Process.Start("explorer.exe", "/select,\"" + Path.Combine(installedExtensionPath, "manifest.json") + "\"");
            }
            catch
            {
                Process.Start("explorer.exe", installedExtensionPath);
            }

            InstallerEngine.OpenChromeExtensions();
            MessageBox.Show(
                this,
                "In Chrome, enable Developer mode, choose Load unpacked, and select:\r\n\r\n" + installedExtensionPath,
                "Finish Media Deck setup",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
        }

        private void CloseButtonClick(object sender, EventArgs e)
        {
            if (!installing)
            {
                Close();
            }
        }

        private void SetProgress(string stage, string message, int percent, bool indeterminate)
        {
            stageLabel.Text = stage;
            messageLabel.Text = message;
            progressBar.Style = indeterminate ? ProgressBarStyle.Marquee : ProgressBarStyle.Continuous;
            if (!indeterminate)
            {
                int value = Math.Max(0, Math.Min(100, percent));
                progressBar.Value = value;
                percentLabel.Text = value.ToString() + "%";
            }
            else
            {
                percentLabel.Text = "…";
            }
        }

        private void AppendLog(string line)
        {
            if (logBox.TextLength > 0)
            {
                logBox.AppendText(Environment.NewLine);
            }

            logBox.AppendText("[" + DateTime.Now.ToString("HH:mm:ss") + "] " + line);
            logBox.SelectionStart = logBox.TextLength;
            logBox.ScrollToCaret();
        }
    }

    internal delegate void ProgressCallback(string stage, string message, int percent, bool indeterminate);
    internal delegate void LogCallback(string message);

    internal sealed class InstallResult
    {
        internal string InstallRoot;
        internal string ExtensionPath;
    }

    internal static class InstallerEngine
    {
        internal static readonly string InstallRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "MediaDeck");

        private static readonly string InstallerLogPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "MediaDeck",
            "install.log");

        internal static InstallResult Install(ProgressCallback progress, LogCallback log)
        {
            progress("Checking system", "Checking Chrome, Python, Node.js, FFmpeg, and the Windows compiler.", 4, false);
            List<string> missing = FindMissingPrerequisites();
            if (missing.Count > 0)
            {
                throw new InvalidOperationException(
                    "Install these prerequisites first, then run setup again: " +
                    string.Join(", ", missing.ToArray()) + ".");
            }

            progress("Validating package", "Checking the embedded Media Deck files.", 10, false);
            ValidateEmbeddedPayload();
            log("Embedded payload validated.");

            string temporaryRoot = Path.Combine(
                Path.GetTempPath(),
                "MediaDeckInstall",
                Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(temporaryRoot);

            try
            {
                progress("Extracting Media Deck", "Preparing the local companion and public Chrome extension.", 18, false);
                ExtractEmbeddedPayload(temporaryRoot);
                log("Payload extracted to temporary staging.");

                progress("Installing files", "Copying Media Deck to the current user profile.", 30, false);
                Directory.CreateDirectory(InstallRoot);
                CopyDirectory(temporaryRoot, InstallRoot);
                CopyInstallerExecutable();
                log("Files installed at " + InstallRoot);

                progress("Installing local runtime", "Creating the Python environment and installing local dependencies. This can take several minutes.", 45, true);
                string setupPath = Path.Combine(InstallRoot, "setup.ps1");
                int setupExitCode = RunProcessWithLog(
                    "powershell.exe",
                    "-NoProfile -ExecutionPolicy Bypass -File \"" + setupPath + "\"",
                    InstallRoot,
                    log);
                if (setupExitCode != 0)
                {
                    throw new InvalidOperationException(
                        "The Media Deck runtime setup failed with exit code " + setupExitCode.ToString() +
                        ". Review " + InstallerLogPath + " for details.");
                }

                progress("Registering installation", "Adding repair and uninstall information for Windows.", 88, false);
                RegisterUninstall();
                WriteInstallInformation();
                log("Native host and uninstall registration completed.");

                progress("Verifying installation", "Checking the installed extension and native host.", 96, false);
                VerifyInstalledFiles();
                log("Installed files verified.");
                AppendPersistentLog("Installation completed successfully.");

                return new InstallResult
                {
                    InstallRoot = InstallRoot,
                    ExtensionPath = Path.Combine(InstallRoot, "extension")
                };
            }
            catch (Exception ex)
            {
                AppendPersistentLog("Installation failed: " + ex);
                throw;
            }
            finally
            {
                TryDeleteDirectory(temporaryRoot);
            }
        }

        internal static int VerifyPackage()
        {
            string verifyPath = Path.Combine(Path.GetTempPath(), "MediaDeckInstallerVerify.log");
            try
            {
                ValidateEmbeddedPayload();
                List<string> missing = FindMissingPrerequisites();
                File.WriteAllText(
                    verifyPath,
                    "Media Deck installer verification passed." + Environment.NewLine +
                    "Payload resource: " + Program.PayloadResourceName + Environment.NewLine +
                    "Stable extension ID: " + Program.StableExtensionId + Environment.NewLine +
                    "Missing optional install-time prerequisites: " +
                    (missing.Count == 0 ? "none" : string.Join(", ", missing.ToArray())) + Environment.NewLine);
                return 0;
            }
            catch (Exception ex)
            {
                File.WriteAllText(verifyPath, "Media Deck installer verification failed." + Environment.NewLine + ex);
                return 1;
            }
        }

        internal static int RunUninstallInteractive()
        {
            DialogResult answer = MessageBox.Show(
                "Remove the Media Deck local companion and native-host registration?\r\n\r\nDownloaded media stored outside the application folder will not be removed.",
                "Uninstall Media Deck",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question);
            if (answer != DialogResult.Yes)
            {
                return 0;
            }

            try
            {
                UnregisterNativeHost();
                Registry.CurrentUser.DeleteSubKeyTree(
                    @"Software\Microsoft\Windows\CurrentVersion\Uninstall\MediaDeck",
                    false);
                string preservedOutput = PreserveUserOutput();
                ScheduleInstallDirectoryRemoval();
                string completionMessage = "Media Deck was unregistered and its application files will be removed.";
                if (!string.IsNullOrWhiteSpace(preservedOutput))
                {
                    completionMessage += "\r\n\r\nSaved media was preserved at:\r\n" + preservedOutput;
                }
                MessageBox.Show(
                    completionMessage,
                    "Media Deck",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
                return 0;
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Media Deck could not be completely removed.\r\n\r\n" + ex.Message,
                    "Uninstall Media Deck",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                return 1;
            }
        }

        internal static void OpenChromeExtensions()
        {
            string[] candidates =
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google", "Chrome", "Application", "chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Google", "Chrome", "Application", "chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Google", "Chrome", "Application", "chrome.exe")
            };

            foreach (string candidate in candidates)
            {
                if (File.Exists(candidate))
                {
                    Process.Start(candidate, "chrome://extensions");
                    return;
                }
            }
        }

        private static List<string> FindMissingPrerequisites()
        {
            List<string> missing = new List<string>();
            if (!CommandWorks("python", "--version"))
            {
                missing.Add("Python");
            }
            if (!CommandWorks("node", "--version"))
            {
                missing.Add("Node.js");
            }
            if (!CommandWorks("ffmpeg", "-version"))
            {
                missing.Add("FFmpeg");
            }
            if (!CommandWorks("ffprobe", "-version"))
            {
                missing.Add("FFprobe");
            }

            string compiler = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.Windows),
                "Microsoft.NET",
                "Framework64",
                "v4.0.30319",
                "csc.exe");
            if (!File.Exists(compiler))
            {
                missing.Add(".NET Framework C# compiler");
            }

            return missing;
        }

        private static bool CommandWorks(string fileName, string arguments)
        {
            try
            {
                using (Process process = Process.Start(new ProcessStartInfo
                {
                    FileName = fileName,
                    Arguments = arguments,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                }))
                {
                    if (process == null)
                    {
                        return false;
                    }
                    return process.WaitForExit(8000) && process.ExitCode == 0;
                }
            }
            catch
            {
                return false;
            }
        }

        private static void ValidateEmbeddedPayload()
        {
            using (Stream resource = Assembly.GetExecutingAssembly().GetManifestResourceStream(Program.PayloadResourceName))
            {
                if (resource == null)
                {
                    throw new InvalidOperationException("The embedded Media Deck payload is missing.");
                }

                using (ZipArchive archive = new ZipArchive(resource, ZipArchiveMode.Read, false))
                {
                    string[] required =
                    {
                        "extension/manifest.json",
                        "setup.ps1",
                        "native_host.py",
                        "playback_server.py",
                        "requirements.txt",
                        "models/hey_jarvis_v0.1.onnx"
                    };

                    foreach (string requiredPath in required)
                    {
                        if (archive.GetEntry(requiredPath) == null)
                        {
                            throw new InvalidOperationException("Required payload file is missing: " + requiredPath);
                        }
                    }
                }
            }
        }

        private static void ExtractEmbeddedPayload(string destination)
        {
            string destinationRoot = Path.GetFullPath(destination).TrimEnd(Path.DirectorySeparatorChar) +
                                     Path.DirectorySeparatorChar;
            using (Stream resource = Assembly.GetExecutingAssembly().GetManifestResourceStream(Program.PayloadResourceName))
            {
                if (resource == null)
                {
                    throw new InvalidOperationException("The embedded Media Deck payload is missing.");
                }

                using (ZipArchive archive = new ZipArchive(resource, ZipArchiveMode.Read, false))
                {
                    foreach (ZipArchiveEntry entry in archive.Entries)
                    {
                        string relativeName = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
                        string targetPath = Path.GetFullPath(Path.Combine(destination, relativeName));
                        if (!targetPath.StartsWith(destinationRoot, StringComparison.OrdinalIgnoreCase))
                        {
                            throw new InvalidOperationException("Unsafe path in installer payload: " + entry.FullName);
                        }

                        if (string.IsNullOrEmpty(entry.Name))
                        {
                            Directory.CreateDirectory(targetPath);
                            continue;
                        }

                        string parent = Path.GetDirectoryName(targetPath);
                        if (!string.IsNullOrEmpty(parent))
                        {
                            Directory.CreateDirectory(parent);
                        }

                        using (Stream input = entry.Open())
                        using (FileStream output = new FileStream(targetPath, FileMode.Create, FileAccess.Write, FileShare.None))
                        {
                            input.CopyTo(output);
                        }
                    }
                }
            }
        }

        private static void CopyDirectory(string source, string destination)
        {
            foreach (string directory in Directory.GetDirectories(source, "*", SearchOption.AllDirectories))
            {
                string relative = directory.Substring(source.Length).TrimStart(Path.DirectorySeparatorChar);
                Directory.CreateDirectory(Path.Combine(destination, relative));
            }

            foreach (string file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
            {
                string relative = file.Substring(source.Length).TrimStart(Path.DirectorySeparatorChar);
                string target = Path.Combine(destination, relative);
                string parent = Path.GetDirectoryName(target);
                if (!string.IsNullOrEmpty(parent))
                {
                    Directory.CreateDirectory(parent);
                }
                File.Copy(file, target, true);
            }
        }

        private static void CopyInstallerExecutable()
        {
            string current = Assembly.GetExecutingAssembly().Location;
            string installed = Path.Combine(InstallRoot, "MediaDeckSetup.exe");
            if (!string.Equals(
                Path.GetFullPath(current),
                Path.GetFullPath(installed),
                StringComparison.OrdinalIgnoreCase))
            {
                File.Copy(current, installed, true);
            }
        }

        private static int RunProcessWithLog(string fileName, string arguments, string workingDirectory, LogCallback log)
        {
            ProcessStartInfo startInfo = new ProcessStartInfo();
            startInfo.FileName = fileName;
            startInfo.Arguments = arguments;
            startInfo.WorkingDirectory = workingDirectory;
            startInfo.UseShellExecute = false;
            startInfo.CreateNoWindow = true;
            startInfo.RedirectStandardOutput = true;
            startInfo.RedirectStandardError = true;

            using (Process process = new Process())
            {
                process.StartInfo = startInfo;
                process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs args)
                {
                    if (!string.IsNullOrWhiteSpace(args.Data))
                    {
                        AppendPersistentLog(args.Data);
                        log(args.Data);
                    }
                };
                process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs args)
                {
                    if (!string.IsNullOrWhiteSpace(args.Data))
                    {
                        AppendPersistentLog(args.Data);
                        log(args.Data);
                    }
                };
                process.Start();
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                process.WaitForExit();
                return process.ExitCode;
            }
        }

        private static void RegisterUninstall()
        {
            string installedSetup = Path.Combine(InstallRoot, "MediaDeckSetup.exe");
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Uninstall\MediaDeck"))
            {
                if (key == null)
                {
                    throw new InvalidOperationException("Windows uninstall registration could not be created.");
                }
                key.SetValue("DisplayName", "Media Deck");
                key.SetValue("DisplayVersion", "0.1.0");
                key.SetValue("Publisher", "Media Deck");
                key.SetValue("InstallLocation", InstallRoot);
                key.SetValue("DisplayIcon", installedSetup);
                key.SetValue("UninstallString", "\"" + installedSetup + "\" /uninstall");
                key.SetValue("ModifyPath", "\"" + installedSetup + "\"");
                key.SetValue("NoModify", 0, RegistryValueKind.DWord);
                key.SetValue("NoRepair", 0, RegistryValueKind.DWord);
            }
        }

        private static void WriteInstallInformation()
        {
            string instructions =
                "Media Deck installation" + Environment.NewLine +
                "Installed: " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + Environment.NewLine +
                "Chrome extension folder: " + Path.Combine(InstallRoot, "extension") + Environment.NewLine +
                "Extension ID: " + Program.StableExtensionId + Environment.NewLine +
                "Native host: com.local.youtube_karaoke" + Environment.NewLine +
                Environment.NewLine +
                "Open chrome://extensions, enable Developer mode, choose Load unpacked, and select the extension folder above." +
                Environment.NewLine;
            File.WriteAllText(Path.Combine(InstallRoot, "INSTALLATION.txt"), instructions);
        }

        private static void VerifyInstalledFiles()
        {
            string[] required =
            {
                Path.Combine(InstallRoot, "extension", "manifest.json"),
                Path.Combine(InstallRoot, "KaraokeNativeHost.exe"),
                Path.Combine(InstallRoot, "host_manifest.json"),
                Path.Combine(InstallRoot, ".venv", "Scripts", "python.exe"),
                Path.Combine(InstallRoot, "MediaDeckSetup.exe")
            };
            foreach (string path in required)
            {
                if (!File.Exists(path))
                {
                    throw new InvalidOperationException("Installed file was not created: " + path);
                }
            }
        }

        private static void UnregisterNativeHost()
        {
            string nativeKey = @"Software\Google\Chrome\NativeMessagingHosts\com.local.youtube_karaoke";
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(nativeKey))
            {
                if (key != null)
                {
                    string registeredManifest = Convert.ToString(key.GetValue(null));
                    if (!string.IsNullOrWhiteSpace(registeredManifest))
                    {
                        string fullManifest = Path.GetFullPath(registeredManifest);
                        string installPrefix = Path.GetFullPath(InstallRoot).TrimEnd(Path.DirectorySeparatorChar) +
                                               Path.DirectorySeparatorChar;
                        if (!fullManifest.StartsWith(installPrefix, StringComparison.OrdinalIgnoreCase))
                        {
                            throw new InvalidOperationException(
                                "Chrome's Media Deck native host points outside the Media Deck install directory and was not removed.");
                        }
                    }
                }
            }
            Registry.CurrentUser.DeleteSubKeyTree(nativeKey, false);
        }

        private static string PreserveUserOutput()
        {
            string outputRoot = Path.Combine(InstallRoot, "output");
            if (!Directory.Exists(outputRoot))
            {
                return string.Empty;
            }

            if (Directory.GetFiles(outputRoot, "*", SearchOption.AllDirectories).Length == 0)
            {
                Directory.Delete(outputRoot, true);
                return string.Empty;
            }

            string musicRoot = Environment.GetFolderPath(Environment.SpecialFolder.MyMusic);
            if (string.IsNullOrWhiteSpace(musicRoot))
            {
                throw new InvalidOperationException(
                    "Saved Media Deck output could not be preserved because the Windows Music folder is unavailable. Move the output folder manually before uninstalling.");
            }

            string recoveryRoot = Path.Combine(musicRoot, "Media Deck");
            Directory.CreateDirectory(recoveryRoot);
            string destination = Path.Combine(
                recoveryRoot,
                "Recovered from uninstall " + DateTime.Now.ToString("yyyyMMdd-HHmmss"));
            int suffix = 2;
            while (Directory.Exists(destination))
            {
                destination = Path.Combine(
                    recoveryRoot,
                    "Recovered from uninstall " + DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + suffix.ToString());
                suffix++;
            }

            Directory.Move(outputRoot, destination);
            return destination;
        }

        private static void ScheduleInstallDirectoryRemoval()
        {
            string localRoot = Path.GetFullPath(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData))
                .TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            string target = Path.GetFullPath(InstallRoot).TrimEnd(Path.DirectorySeparatorChar);
            if (!target.StartsWith(localRoot, StringComparison.OrdinalIgnoreCase) ||
                string.Equals(target, localRoot.TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("Refusing to remove an unsafe installation path.");
            }

            string cleanup = Path.Combine(Path.GetTempPath(), "MediaDeckCleanup-" + Guid.NewGuid().ToString("N") + ".cmd");
            string script =
                "@echo off" + Environment.NewLine +
                "ping 127.0.0.1 -n 3 > nul" + Environment.NewLine +
                "rmdir /s /q \"" + target + "\"" + Environment.NewLine +
                "del /q \"%~f0\"" + Environment.NewLine;
            File.WriteAllText(cleanup, script, Encoding.ASCII);
            Process.Start(new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = "/c \"" + cleanup + "\"",
                UseShellExecute = false,
                CreateNoWindow = true
            });
        }

        private static void AppendPersistentLog(string message)
        {
            try
            {
                Directory.CreateDirectory(InstallRoot);
                File.AppendAllText(
                    InstallerLogPath,
                    "[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] " + message + Environment.NewLine);
            }
            catch
            {
            }
        }

        private static void TryDeleteDirectory(string path)
        {
            try
            {
                if (Directory.Exists(path))
                {
                    Directory.Delete(path, true);
                }
            }
            catch
            {
            }
        }
    }
}
