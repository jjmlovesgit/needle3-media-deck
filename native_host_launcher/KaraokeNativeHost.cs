using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

internal static class KaraokeNativeHost
{
    private static void Pump(Stream source, Stream destination, bool closeDestination)
    {
        try
        {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = source.Read(buffer, 0, buffer.Length)) > 0)
            {
                destination.Write(buffer, 0, read);
                destination.Flush();
            }
        }
        catch (IOException) { }
        catch (ObjectDisposedException) { }
        finally
        {
            if (closeDestination)
            {
                try { destination.Close(); } catch { }
            }
        }
    }

    [STAThread]
    private static int Main()
    {
        string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        string python = Path.Combine(root, ".venv", "Scripts", "python.exe");
        string host = Path.Combine(root, "native_host.py");
        if (!File.Exists(python) || !File.Exists(host)) return 2;

        ProcessStartInfo start = new ProcessStartInfo
        {
            FileName = python,
            Arguments = "\"" + host + "\"",
            WorkingDirectory = root,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };

        using (Process child = Process.Start(start))
        {
            Thread input = new Thread(() => Pump(Console.OpenStandardInput(), child.StandardInput.BaseStream, true));
            Thread output = new Thread(() => Pump(child.StandardOutput.BaseStream, Console.OpenStandardOutput(), false));
            Thread error = new Thread(() =>
            {
                try { while (child.StandardError.ReadLine() != null) { } } catch { }
            });
            input.IsBackground = true;
            output.IsBackground = true;
            error.IsBackground = true;
            input.Start();
            output.Start();
            error.Start();
            child.WaitForExit();
            output.Join(2000);
            return child.ExitCode;
        }
    }
}
