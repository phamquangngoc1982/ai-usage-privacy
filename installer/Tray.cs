using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

public sealed class Snapshot
{
    public int version { get; set; }
    public Service[] services { get; set; }
}
public sealed class Service
{
    public string name { get; set; }
    public long updatedAt { get; set; }
    public string state { get; set; }
    public Reading[] rows { get; set; }
}
public sealed class Reading
{
    public string label { get; set; }
    public double? percent { get; set; }
    public string reset { get; set; }
    public string note { get; set; }
}

static class Program
{
    internal const string HostKey = @"Software\Google\Chrome\NativeMessagingHosts\com.aiusage.tray";
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    const string RunName = "AI Usage Tray";
    internal static readonly string Data = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AIUsageTray", "usage.json");
    internal static Snapshot Decode(string data)
    {
        var snapshot = new JavaScriptSerializer().Deserialize<Snapshot>(data);
        if (snapshot == null || snapshot.version != 1 || snapshot.services == null ||
            snapshot.services.Length > 10 ||
            snapshot.services.Any(s => s == null || String.IsNullOrWhiteSpace(s.name) || s.name.Length > 80 ||
                s.updatedAt < 0 || s.updatedAt > 253402300799999L || s.rows == null ||
                s.rows.Length > 12 || s.rows.Any(r => r == null ||
                    (r.percent.HasValue && (Double.IsNaN(r.percent.Value) || r.percent < 0 || r.percent > 100)))))
            throw new InvalidDataException();
        return snapshot;
    }

    [STAThread]
    static void Main(string[] args)
    {
        if (args.Length > 0 && args[0].StartsWith("chrome-extension://", StringComparison.Ordinal))
        {
            Receive();
            return;
        }
        if (args.Length == 1 && args[0] == "--shortcuts")
        {
            try { CreateShortcuts(); }
            catch (Exception error)
            {
                MessageBox.Show(error.Message, "AI Usage Tray");
                Environment.ExitCode = 1;
            }
            return;
        }
        if (args.Length > 0 && args[0] == "--register")
        {
            try
            {
                if (args.Length != 2 || !System.Text.RegularExpressions.Regex.IsMatch(args[1], "^[a-p]{32}$"))
                    throw new ArgumentException("Enter the 32-letter Chrome extension ID.");
                RegisterHost(args[1]);
            }
            catch (Exception error)
            {
                MessageBox.Show(error.Message, "AI Usage Tray");
                Environment.ExitCode = 1;
            }
            return;
        }
        bool created;
        bool demo = args.Contains("--demo");
        using (var mutex = new System.Threading.Mutex(true, demo ? "AIUsageTray-Demo" : "AIUsageTray-Live", out created))
        {
            if (!created) return;
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            using (var tray = new Tray(demo)) Application.Run(tray);
        }
    }

    static void CreateShortcuts()
    {
        Type shellType = Type.GetTypeFromProgID("WScript.Shell");
        object shell = Activator.CreateInstance(shellType);
        try
        {
            foreach (var folder in new[] {Environment.SpecialFolder.DesktopDirectory, Environment.SpecialFolder.Programs})
            {
                string path = Path.Combine(Environment.GetFolderPath(folder), "AI Usage Tray.lnk");
                object shortcut = shellType.InvokeMember("CreateShortcut",
                    System.Reflection.BindingFlags.InvokeMethod, null, shell, new object[] {path});
                try
                {
                    Type type = shortcut.GetType();
                    type.InvokeMember("TargetPath", System.Reflection.BindingFlags.SetProperty,
                        null, shortcut, new object[] {Application.ExecutablePath});
                    type.InvokeMember("WorkingDirectory", System.Reflection.BindingFlags.SetProperty,
                        null, shortcut, new object[] {Path.GetDirectoryName(Application.ExecutablePath)});
                    type.InvokeMember("Description", System.Reflection.BindingFlags.SetProperty,
                        null, shortcut, new object[] {"AI Usage Tray"});
                    type.InvokeMember("Save", System.Reflection.BindingFlags.InvokeMethod,
                        null, shortcut, null);
                }
                finally { Marshal.FinalReleaseComObject(shortcut); }
            }
        }
        finally { Marshal.FinalReleaseComObject(shell); }
    }

    static void RegisterHost(string extensionId)
    {
        string exe = Application.ExecutablePath;
        string manifest = Path.Combine(Path.GetDirectoryName(exe), "native-host.json");
        var settings = new
        {
            name = "com.aiusage.tray",
            description = "AI Usage Windows tray",
            path = exe,
            type = "stdio",
            allowed_origins = new[] {"chrome-extension://" + extensionId + "/"}
        };
        File.WriteAllText(manifest, new JavaScriptSerializer().Serialize(settings), new UTF8Encoding(false));
        using (var key = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(
            HostKey))
            key.SetValue("", manifest, Microsoft.Win32.RegistryValueKind.String);
    }

    internal static bool AutoStart
    {
        get
        {
            using (var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(RunKey))
                return key != null && String.Equals(key.GetValue(RunName) as string,
                    "\"" + Application.ExecutablePath + "\"", StringComparison.OrdinalIgnoreCase);
        }
        set
        {
            using (var key = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(RunKey))
            {
                if (value) key.SetValue(RunName, "\"" + Application.ExecutablePath + "\"");
                else key.DeleteValue(RunName, false);
            }
        }
    }

    internal static string ConnectionDetails()
    {
        string state = "Chưa đăng ký kết nối Chrome.";
        using (var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(HostKey))
        {
            string manifest = key == null ? null : key.GetValue("") as string;
            if (manifest != null && File.Exists(manifest))
            {
                var settings = new JavaScriptSerializer().DeserializeObject(File.ReadAllText(manifest))
                    as Dictionary<string, object>;
                object origins;
                if (settings != null && settings.TryGetValue("allowed_origins", out origins))
                {
                    var list = origins as object[];
                    if (list != null && list.Length == 1)
                        state = "Đã đăng ký: " + (list[0] as string);
                }
            }
        }
        return state + "\n\n" + (File.Exists(Data)
            ? "Lần nhận dữ liệu: " + File.GetLastWriteTime(Data).ToString("dd/MM/yyyy HH:mm:ss")
            : "Chưa nhận dữ liệu. Mở AI Usage trong Chrome và bấm Kết nối khay Windows.");
    }

    static void Receive()
    {
        bool ok = false;
        string temporary = null;
        try
        {
            using (var reader = new BinaryReader(Console.OpenStandardInput()))
            {
                int length = reader.ReadInt32();
                if (length <= 0 || length > 131072) throw new InvalidDataException();
                var data = reader.ReadBytes(length);
                if (data.Length != length) throw new EndOfStreamException();
                string json = Encoding.UTF8.GetString(data);
                Decode(json);
                Directory.CreateDirectory(Path.GetDirectoryName(Data));
                temporary = Path.Combine(Path.GetDirectoryName(Data), Guid.NewGuid().ToString("N") + ".tmp");
                File.WriteAllText(temporary, json, new UTF8Encoding(false));
                using (var gate = new System.Threading.Mutex(false, "AIUsageTray-Snapshot"))
                {
                    try { gate.WaitOne(); }
                    catch (System.Threading.AbandonedMutexException) {}
                    try
                    {
                        if (File.Exists(Data)) File.Replace(temporary, Data, null);
                        else File.Move(temporary, Data);
                    }
                    finally { gate.ReleaseMutex(); }
                }
                ok = true;
            }
        }
        catch { }
        finally
        {
            if (temporary != null) try { File.Delete(temporary); } catch (IOException) { }
        }
        using (var writer = new BinaryWriter(Console.OpenStandardOutput()))
        {
            byte[] bytes = Encoding.UTF8.GetBytes(ok ? "{\"ok\":true}" : "{\"ok\":false}");
            writer.Write(bytes.Length);
            writer.Write(bytes);
        }
    }
}

sealed class Tray : ApplicationContext
{
    readonly Dictionary<string, NotifyIcon> icons = new Dictionary<string, NotifyIcon>();
    readonly Timer timer = new Timer();
    readonly bool demo;
    string previous;

    public Tray(bool demoMode)
    {
        demo = demoMode;
        timer.Interval = 2000;
        timer.Tick += delegate { Update(); };
        timer.Start();
        Update();
    }

    static long Now()
    {
        return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds;
    }

    Snapshot Demo()
    {
        var services = new[] {"ChatGPT / Codex", "Claude", "Gemini"};
        var consumed = new[] {62.0, 82.0, 22.0};
        return new Snapshot {version = 1, services = services.Select((name, index) => new Service {
            name = name + " (mẫu)", updatedAt = Now(),
            rows = new[] {new Reading {label = "Hạn mức mẫu", percent = consumed[index]}}
        }).ToArray()};
    }

    void Update()
    {
        Snapshot snapshot = new Snapshot {services = new Service[0]};
        string data = "";
        if (demo) snapshot = Demo();
        else
        {
            try
            {
                if (File.Exists(Program.Data))
                {
                    data = File.ReadAllText(Program.Data);
                    snapshot = Program.Decode(data);
                }
            }
            catch { return; }
        }
        long now = Now();
        // Re-evaluate each icon's own freshness even when another icon is already stale.
        string freshness = String.Join(",", snapshot.services.Select(s => IsStale(s, now) ? "1" : "0"));
        string signature = (demo ? "demo" : data) + "|" + freshness;
        if (previous == signature) return;
        previous = signature;
        var names = new HashSet<string>();
        foreach (var service in snapshot.services)
        {
            if (!names.Add(service.name)) continue;
            var limiting = service.rows.Where(r => r.percent.HasValue).OrderByDescending(r => r.percent).FirstOrDefault();
            int? left = limiting == null ? (int?)null : (int)Math.Floor(100 - limiting.percent.Value);
            SetIcon(service.name, left, IsStale(service, now), Details(service));
        }
        if (names.Count == 0)
        {
            names.Add("AI Usage Tray");
            SetIcon("AI Usage Tray", null, true, "Chưa có số liệu. Mở tiện ích Chrome và bấm Đồng bộ khay Windows.");
        }
        foreach (var name in icons.Keys.Where(name => !names.Contains(name)).ToArray()) Remove(name);
    }

    static bool IsStale(Service service, long now)
    {
        return service.updatedAt == 0 || now - service.updatedAt >= 30 * 60000L ||
            service.state == "unreadable" || service.state == "signin";
    }

    static string Details(Service service)
    {
        var lines = service.rows.Select(r => r.label +
            (r.percent.HasValue ? " · còn " + (100 - r.percent.Value).ToString("0.##") + "%" : "") +
            (String.IsNullOrEmpty(r.reset) ? "" : "\n" + r.reset) +
            (String.IsNullOrEmpty(r.note) ? "" : "\n" + r.note)).ToList();
        if (service.updatedAt > 0)
            lines.Add("Cập nhật: " + new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)
                .AddMilliseconds(service.updatedAt).ToLocalTime().ToString("dd/MM HH:mm"));
        if (IsStale(service, Now())) lines.Add("Số liệu chưa có hoặc đã cũ.");
        return String.Join("\n\n", lines);
    }

    void SetIcon(string name, int? left, bool stale, string details)
    {
        NotifyIcon icon;
        if (!icons.TryGetValue(name, out icon))
        {
            icon = new NotifyIcon();
            icons.Add(name, icon);
        }
        var old = icon.Icon;
        icon.Icon = DrawIcon(left, stale);
        if (old != null) old.Dispose();
        string text = name + (left.HasValue ? " " + left.Value + "%" : "") +
            (stale ? " · số liệu cũ hoặc chưa có" : "");
        icon.Text = text.Substring(0, Math.Min(63, text.Length));
        var oldMenu = icon.ContextMenuStrip;
        var menu = new ContextMenuStrip();
        menu.Items.Add("Chi tiết", null, delegate { MessageBox.Show(details, name); });
        if (!demo)
        {
            menu.Items.Add("Kiểm tra kết nối Chrome", null, delegate {
                try { MessageBox.Show(Program.ConnectionDetails(), "AI Usage Tray"); }
                catch (Exception error) { MessageBox.Show(error.Message, "AI Usage Tray"); }
            });
            var startup = new ToolStripMenuItem("Khởi động cùng Windows");
            startup.Click += delegate {
                try { Program.AutoStart = !Program.AutoStart; }
                catch (Exception error) { MessageBox.Show(error.Message, "AI Usage Tray"); }
            };
            menu.Opening += delegate {
                try { startup.Checked = Program.AutoStart; }
                catch { startup.Enabled = false; }
            };
            menu.Items.Add(startup);
            menu.Items.Add(new ToolStripSeparator());
        }
        menu.Items.Add("Thoát AI Usage Tray", null, delegate { ExitThread(); });
        icon.ContextMenuStrip = menu;
        if (oldMenu != null) oldMenu.Dispose();
        icon.Tag = details;
        icon.Visible = true;
        icon.MouseClick -= ShowDetails;
        icon.MouseClick += ShowDetails;
    }

    static void ShowDetails(object sender, MouseEventArgs args)
    {
        if (args.Button == MouseButtons.Left)
        {
            var icon = (NotifyIcon)sender;
            MessageBox.Show((string)icon.Tag, icon.Text);
        }
    }

    [DllImport("user32.dll")]
    static extern bool DestroyIcon(IntPtr handle);

    static Icon DrawIcon(int? left, bool stale)
    {
        const int size = 32;
        const float padding = 2;
        string label = left.HasValue ? left.Value.ToString("D2", CultureInfo.InvariantCulture) : "–";
        using (var bitmap = new Bitmap(size, size))
        using (var canvas = Graphics.FromImage(bitmap))
        using (var glyphs = new GraphicsPath())
        using (var layout = StringFormat.GenericTypographic)
        using (var transform = new Matrix())
        using (var brush = new SolidBrush(stale || !left.HasValue ? Color.FromArgb(225, 230, 235)
            : left.Value <= 10 ? Color.Salmon : left.Value <= 25 ? Color.Khaki : Color.PaleGreen))
        {
            glyphs.AddString(label, SystemFonts.MessageBoxFont.FontFamily, (int)FontStyle.Bold,
                size, PointF.Empty, layout);
            RectangleF bounds = glyphs.GetBounds();
            // Fit the actual glyph outlines, including all three digits for 100.
            float inner = size - 2 * padding;
            float scale = Math.Min(inner / bounds.Width, inner / bounds.Height);
            transform.Scale(scale, scale);
            transform.Translate((size / scale - bounds.Width) / 2 - bounds.X,
                (size / scale - bounds.Height) / 2 - bounds.Y);
            glyphs.Transform(transform);

            canvas.SmoothingMode = SmoothingMode.AntiAlias;
            canvas.Clear(Color.Black);
            canvas.FillPath(brush, glyphs);
            var handle = bitmap.GetHicon();
            try { using (var icon = Icon.FromHandle(handle)) return (Icon)icon.Clone(); }
            finally { DestroyIcon(handle); }
        }
    }

    void Remove(string name)
    {
        var icon = icons[name];
        icon.Visible = false;
        if (icon.ContextMenuStrip != null) icon.ContextMenuStrip.Dispose();
        if (icon.Icon != null) icon.Icon.Dispose();
        icon.Dispose();
        icons.Remove(name);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            timer.Dispose();
            foreach (var name in icons.Keys.ToArray()) Remove(name);
        }
        base.Dispose(disposing);
    }
}
