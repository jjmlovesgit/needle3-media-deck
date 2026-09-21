using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class MediaDeckLauncher
{
    private const string ProductName = "Needle 3 Media Deck";

    [STAThread]
    private static int Main(string[] args)
    {
        Process server = null;
        bool smokeTest = HasArgument(args, "--smoke-test");
        try
        {
            string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            string node = Path.Combine(root, "runtime", "node.exe");
            string serverScript = Path.Combine(root, "spa", "scripts", "serve.mjs");
            RequireFile(node, "The bundled Node.js runtime is missing.");
            RequireFile(serverScript, "The Media Deck server is missing.");

            string library = ReadArgument(args, "--library");
            if (String.IsNullOrWhiteSpace(library)) library = LoadSavedLibrary();
            if (String.IsNullOrWhiteSpace(library) || !Directory.Exists(library))
            {
                if (smokeTest) throw new InvalidOperationException("Pass an existing media folder with --library for the smoke test.");
                library = ChooseLibrary();
            }
            library = Path.GetFullPath(library);
            if (!smokeTest) SaveLibrary(library);

            int port = FindFreeLoopbackPort();
            string url = "http://127.0.0.1:" + port + "/";
            server = StartServer(node, serverScript, root, library, port);
            WaitForServer(server, url, 45000);

            if (smokeTest)
            {
                RequireResponse(url, true);
                RequireResponse(url + "api/library", false);
                StopServer(server);
                return 0;
            }

            string chrome = FindChrome();
            if (chrome == null) throw new InvalidOperationException("Google Chrome is required. Install Chrome or use npm start for browser development.");
            Process browser = StartChrome(chrome, url);
            browser.WaitForExit();
            StopServer(server);
            return 0;
        }
        catch (Exception error)
        {
            if (server != null) StopServer(server);
            if (smokeTest) { AppendLog("Smoke test failed: " + error); return 1; }
            MessageBox.Show(error.Message, ProductName, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static bool HasArgument(string[] args, string name)
    {
        foreach (string value in args) if (String.Equals(value, name, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    private static string ReadArgument(string[] args, string name)
    {
        for (int i = 0; i < args.Length - 1; i++)
            if (String.Equals(args[i], name, StringComparison.OrdinalIgnoreCase)) return args[i + 1];
        return null;
    }

    private static void RequireFile(string filename, string message)
    {
        if (!File.Exists(filename)) throw new FileNotFoundException(message, filename);
    }

    private static string SettingsDirectory()
    {
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Needle3MediaDeck");
    }

    private static string LoadSavedLibrary()
    {
        string filename = Path.Combine(SettingsDirectory(), "library.txt");
        return File.Exists(filename) ? File.ReadAllText(filename, Encoding.UTF8).Trim() : null;
    }

    private static void SaveLibrary(string library)
    {
        Directory.CreateDirectory(SettingsDirectory());
        File.WriteAllText(Path.Combine(SettingsDirectory(), "library.txt"), library, new UTF8Encoding(false));
    }

    private static string ChooseLibrary()
    {
        Application.EnableVisualStyles();
        using (FolderBrowserDialog dialog = new FolderBrowserDialog())
        {
            dialog.Description = "Choose the local MP3 and MP4 media library for Needle 3 Media Deck.";
            dialog.ShowNewFolderButton = false;
            if (dialog.ShowDialog() != DialogResult.OK || String.IsNullOrWhiteSpace(dialog.SelectedPath))
                throw new OperationCanceledException("No media folder was selected.");
            return dialog.SelectedPath;
        }
    }

    private static int FindFreeLoopbackPort()
    {
        TcpListener listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        int port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    private static Process StartServer(string node, string script, string root, string library, int port)
    {
        ProcessStartInfo info = new ProcessStartInfo(node, Quote(script));
        info.WorkingDirectory = root;
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        info.RedirectStandardInput = true;
        info.RedirectStandardOutput = true;
        info.RedirectStandardError = true;
        info.EnvironmentVariables["MEDIA_DECK_PORT"] = port.ToString();
        info.EnvironmentVariables["MEDIA_DECK_LIBRARY"] = library;
        info.EnvironmentVariables["MEDIA_DECK_LAUNCHER"] = "1";
        Process process = new Process();
        process.StartInfo = info;
        process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs eventArgs) { if (eventArgs.Data != null) AppendLog(eventArgs.Data); };
        process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs eventArgs) { if (eventArgs.Data != null) AppendLog(eventArgs.Data); };
        if (!process.Start()) throw new InvalidOperationException("The local Media Deck server could not start.");
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        return process;
    }

    private static void WaitForServer(Process process, string url, int timeoutMilliseconds)
    {
        Stopwatch watch = Stopwatch.StartNew();
        Exception lastError = null;
        while (watch.ElapsedMilliseconds < timeoutMilliseconds)
        {
            if (process.HasExited) throw new InvalidOperationException("The local Media Deck server stopped during startup. See " + LogPath());
            try { RequireResponse(url, true); return; }
            catch (Exception error) { lastError = error; Thread.Sleep(150); }
        }
        throw new TimeoutException("The local Media Deck server did not become ready. " + (lastError == null ? "" : lastError.Message));
    }

    private static void RequireResponse(string url, bool requireCsp)
    {
        HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
        request.Timeout = 15000;
        request.ReadWriteTimeout = 15000;
        request.Proxy = null;
        using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
        {
            if (response.StatusCode != HttpStatusCode.OK) throw new InvalidOperationException("Unexpected response from " + url);
            if (requireCsp)
            {
                string policy = response.Headers["Content-Security-Policy"];
                if (String.IsNullOrWhiteSpace(policy) || !policy.Contains("default-src 'self'") ||
                    !policy.Contains("connect-src 'self'") || !policy.Contains("'wasm-unsafe-eval'"))
                    throw new InvalidOperationException("The local-only WebAssembly content policy is missing or incomplete.");
            }
            using (Stream stream = response.GetResponseStream()) if (stream != null) stream.CopyTo(Stream.Null);
        }
    }

    private static string FindChrome()
    {
        string[] registryKeys = {
            @"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe",
            @"HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe",
            @"HKEY_LOCAL_MACHINE\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"
        };
        foreach (string key in registryKeys)
        {
            string value = Registry.GetValue(key, "", null) as string;
            if (!String.IsNullOrWhiteSpace(value) && File.Exists(value)) return value;
        }
        string[] candidates = {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Google\Chrome\Application\chrome.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Google\Chrome\Application\chrome.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Google\Chrome\Application\chrome.exe")
        };
        foreach (string candidate in candidates) if (File.Exists(candidate)) return candidate;
        return null;
    }

    private static Process StartChrome(string chrome, string url)
    {
        string profile = Path.Combine(SettingsDirectory(), "ChromeProfile");
        Directory.CreateDirectory(profile);
        string arguments = "--app=" + Quote(url) + " --user-data-dir=" + Quote(profile) +
            " --no-first-run --no-default-browser-check --disable-background-mode --disable-background-networking" +
            " --disable-component-update --disable-default-apps --disable-domain-reliability --disable-sync --disable-translate --no-proxy-server";
        Process process = Process.Start(new ProcessStartInfo(chrome, arguments) { UseShellExecute = false });
        if (process == null) throw new InvalidOperationException("Google Chrome could not start.");
        return process;
    }

    private static string Quote(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }

    private static void StopServer(Process process)
    {
        if (process == null) return;
        try
        {
            if (!process.HasExited) process.StandardInput.Close();
            if (!process.WaitForExit(5000) && !process.HasExited) process.Kill();
        }
        catch { try { if (!process.HasExited) process.Kill(); } catch { } }
        finally { process.Dispose(); }
    }

    private static string LogPath()
    {
        Directory.CreateDirectory(SettingsDirectory());
        return Path.Combine(SettingsDirectory(), "launcher.log");
    }

    private static void AppendLog(string line)
    {
        try { File.AppendAllText(LogPath(), DateTime.UtcNow.ToString("o") + " " + line + Environment.NewLine, Encoding.UTF8); }
        catch { }
    }
}
