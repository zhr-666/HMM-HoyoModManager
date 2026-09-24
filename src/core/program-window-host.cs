using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

// Fixed application-owned Win32 bridge. User paths only enter ProcessStartInfo.FileName.
public static class ProgramWindowHost {
    delegate bool EnumProc(IntPtr window, IntPtr data);
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr Window; public uint Message; public UIntPtr WParam; public IntPtr LParam; public uint Time; public int X,Y; public uint Private; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct PROCESSENTRY32 {
        public uint Size, Usage, Id; public IntPtr Heap; public uint Module, Threads, Parent; public int Priority; public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string File;
    }
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint id);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snapshot,ref PROCESSENTRY32 entry);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool Process32NextW(IntPtr snapshot,ref PROCESSENTRY32 entry);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access,bool inherit,uint id);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageNameW(IntPtr process,uint flags,StringBuilder name,ref uint size);
    [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr process,out long created,out long exited,out long kernel,out long user);
    [DllImport("kernel32.dll")] static extern void SetLastError(uint error);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback,IntPtr data);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window,uint command);
    [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr window);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassNameW(IntPtr window,StringBuilder name,int size);
    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetParent(IntPtr window,IntPtr parent);
    [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr window,int index);
    [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW", SetLastError=true)] static extern IntPtr SetWindowLongPtr(IntPtr window,int index,IntPtr value);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window,out RECT rect);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr window,out RECT rect);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr window);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern IntPtr GetWindowDpiAwarenessContext(IntPtr window);
    [DllImport("user32.dll", SetLastError=true)] static extern bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int width,int height,uint flags);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window,int command);
    [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr window,int command);
    [DllImport("user32.dll", SetLastError=true)] static extern bool PostMessageW(IntPtr window,uint message,IntPtr wParam,IntPtr lParam);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from,uint to,bool attach);
    [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr window);
    [DllImport("user32.dll")] static extern bool PeekMessageW(out MSG message,IntPtr window,uint first,uint last,uint remove);
    const long CHILD=0x40000000L, POPUP=0x80000000L, CAPTION=0x00C00000L, THICKFRAME=0x00040000L, APPWINDOW=0x00040000L, TOOLWINDOW=0x00000080L, VISIBLE=0x10000000L;
    class ProcessInfo { public uint pid,ppid; public string file,start; }
    class Saved { public IntPtr Window,Parent,Style,Extended; public RECT Bounds; public uint Pid; public string Start; }
    static readonly Dictionary<long,Saved> Windows=new Dictionary<long,Saved>();
    static IntPtr ParentWindow,Selected; static int Top=40;
    static JavaScriptSerializer Json=new JavaScriptSerializer { MaxJsonLength=16*1024*1024 };
    static ProcessInfo Info(uint pid,uint ppid) {
        IntPtr h=OpenProcess(0x1000,false,pid); if(h==IntPtr.Zero)return null;
        try { long start,exit,kernel,user; if(!GetProcessTimes(h,out start,out exit,out kernel,out user))return null;
            var name=new StringBuilder(32768);uint size=32768;
            string file=QueryFullProcessImageNameW(h,0,name,ref size)?name.ToString():"";
            return new ProcessInfo {pid=pid,ppid=ppid,file=file,start=start.ToString()};
        } finally { CloseHandle(h); }
    }
    static bool Matches(uint pid,string start) { var p=Info(pid,0);return p!=null&&p.start==start; }
    static bool Valid(Saved w) {uint pid;GetWindowThreadProcessId(w.Window,out pid);return IsWindow(w.Window)&&pid==w.Pid&&Matches(pid,w.Start);}
    static List<ProcessInfo> Processes() {
        var rows=new List<ProcessInfo>();IntPtr h=CreateToolhelp32Snapshot(2,0);
        if(h.ToInt64()==-1)throw new Win32Exception();
        try { var e=new PROCESSENTRY32();e.Size=(uint)Marshal.SizeOf(e);
            if(Process32FirstW(h,ref e))do {var p=Info(e.Id,e.Parent);if(p!=null)rows.Add(p);} while(Process32NextW(h,ref e));
        } finally {CloseHandle(h);}return rows;
    }
    static bool MainWindow(IntPtr h) {
        if(!IsWindowVisible(h)||GetWindow(h,4)!=IntPtr.Zero||(GetWindowLongPtr(h,-16).ToInt64()&CHILD)!=0)return false;
        var name=new StringBuilder(256);GetClassNameW(h,name,256);if(name.ToString()=="#32770")return false;
        RECT rect;return GetWindowRect(h,out rect)&&rect.Right>rect.Left&&rect.Bottom>rect.Top;
    }
    static object Scan() {
        var processes=Processes();var byPid=new Dictionary<uint,ProcessInfo>();foreach(var p in processes)byPid[p.pid]=p;
        var windows=new List<object>();var seen=new HashSet<long>();
        Action<IntPtr> add=h=>{uint pid;GetWindowThreadProcessId(h,out pid);ProcessInfo p;if(!byPid.TryGetValue(pid,out p)||!seen.Add(h.ToInt64()))return;windows.Add(new {handle=h.ToInt64().ToString(),pid=pid,start=p.start});};
        EnumWindows((h,d)=>{if(MainWindow(h))add(h);return true;},IntPtr.Zero);
        foreach(var w in Windows.Values)if(Valid(w))add(w.Window);
        uint foregroundPid;IntPtr foregroundWindow=GetForegroundWindow();GetWindowThreadProcessId(foregroundWindow,out foregroundPid);
        return new {admin=new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator),processes=processes,windows=windows,foreground=new {pid=foregroundPid,handle=foregroundWindow.ToInt64().ToString()}};
    }
    static void SetStyle(IntPtr h,int index,IntPtr style) {
        SetLastError(0);var previous=SetWindowLongPtr(h,index,style);
        if(previous==IntPtr.Zero&&Marshal.GetLastWin32Error()!=0)throw new Win32Exception();
    }
    static void HideBeforeStyleChange(IntPtr window) {
        // Shell removes an existing taskbar entry only while the original
        // taskbar-eligible style is still present. Complete SW_HIDE before
        // SetWindowLongPtr/SetParent; ShowWindowAsync can race those calls.
        ShowWindow(window,0);
        if(IsWindowVisible(window))throw new Exception("无法隐藏程序窗口，已取消嵌入。");
    }
    static void Restore(Saved w) {
        if(!Valid(w))return;
        HideBeforeStyleChange(w.Window);
        SetParent(w.Window,IsWindow(w.Parent)?w.Parent:IntPtr.Zero);
        SetStyle(w.Window,-16,new IntPtr(w.Style.ToInt64()&~VISIBLE));SetStyle(w.Window,-20,w.Extended);
        SetWindowPos(w.Window,IntPtr.Zero,w.Bounds.Left,w.Bounds.Top,w.Bounds.Right-w.Bounds.Left,w.Bounds.Bottom-w.Bounds.Top,0x0034);
        ShowWindowAsync(w.Window,5);
    }
    static void Layout() {
        IntPtr old=SetThreadDpiAwarenessContext(GetWindowDpiAwarenessContext(ParentWindow));
        try {RECT r;if(!GetClientRect(ParentWindow,out r))return;int top=(int)Math.Round(Top*GetDpiForWindow(ParentWindow)/96.0);
            foreach(var w in Windows.Values)if(Valid(w)) {
                bool visible=w.Window==Selected;ShowWindowAsync(w.Window,visible?4:0);
                if(visible&&!SetWindowPos(w.Window,IntPtr.Zero,0,top,Math.Max(1,r.Right),Math.Max(1,r.Bottom-top),0x0050))throw new Win32Exception();
            }
        } finally {SetThreadDpiAwarenessContext(old);}
    }
    static string Text(Dictionary<string,object> p,string key) {object value;return p.TryGetValue(key,out value)?Convert.ToString(value):"";}
    static void FocusSelected() {
        Saved target;if(!Windows.TryGetValue(Selected.ToInt64(),out target)||!Valid(target))return;
        MSG message;PeekMessageW(out message,IntPtr.Zero,0,0,0); // Ensure this helper thread has an input queue.
        uint ignored;uint thread=GetWindowThreadProcessId(Selected,out ignored),current=GetCurrentThreadId();
        bool attached=thread!=current&&AttachThreadInput(current,thread,true);
        try {SetForegroundWindow(ParentWindow);if(thread==current||attached)SetFocus(Selected);}
        finally {if(attached)AttachThreadInput(current,thread,false);}
    }
    static object Command(string action,Dictionary<string,object> p) {
        if(action=="scan")return Scan();
        if(action=="launch") {
            if(!new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator))throw new Exception("请以管理员身份运行 HMM。");
            string file=Text(p,"file");if(!Path.IsPathRooted(file)||!file.EndsWith(".exe",StringComparison.OrdinalIgnoreCase)||!File.Exists(file))throw new Exception("请选择有效的 EXE 程序。");
            foreach(var existing in Processes())if(String.Equals(existing.file,file,StringComparison.OrdinalIgnoreCase))throw new Exception("一级程序已经运行。");
            using(var process=Process.Start(new ProcessStartInfo {FileName=file,WorkingDirectory=Path.GetDirectoryName(file),UseShellExecute=false})) {
                // Read identity from the started process handle even for a short-lived launcher.
                return new ProcessInfo {pid=(uint)process.Id,ppid=(uint)Process.GetCurrentProcess().Id,file=file,start=process.StartTime.ToUniversalTime().ToFileTimeUtc().ToString()};
            }
        }
        if(action=="resize") {Top=Math.Max(0,Math.Min(200,Convert.ToInt32(p["top"])));Layout();return null;}
        if(action=="select") {var next=new IntPtr(Int64.Parse(Text(p,"handle")));bool changed=next!=Selected;Selected=next;Layout();if(changed&&Selected!=IntPtr.Zero)FocusSelected();return null;}
        if(action=="close") {
            uint pid=Convert.ToUInt32(p["pid"]);string start=Text(p,"start");if(!Matches(pid,start))return null;
            foreach(var w in new List<Saved>(Windows.Values))if(w.Pid==pid&&w.Start==start){Restore(w);Windows.Remove(w.Window.ToInt64());}
            EnumWindows((h,d)=>{uint actual;GetWindowThreadProcessId(h,out actual);if(actual==pid&&GetWindow(h,4)==IntPtr.Zero)PostMessageW(h,0x0010,IntPtr.Zero,IntPtr.Zero);return true;},IntPtr.Zero);
            return null;
        }
        var window=new IntPtr(Int64.Parse(Text(p,"handle")));
        if(action=="forget") {Saved old;if(Windows.TryGetValue(window.ToInt64(),out old)){Restore(old);Windows.Remove(window.ToInt64());}return null;}
        if(action=="attach") {
            uint pid;GetWindowThreadProcessId(window,out pid);string start=Text(p,"start");
            if(pid!=Convert.ToUInt32(p["pid"])||!Matches(pid,start)||!MainWindow(window))throw new Exception("目标窗口已变化或不支持嵌入。");
            var w=new Saved {Window=window,Parent=GetParent(window),Style=GetWindowLongPtr(window,-16),Extended=GetWindowLongPtr(window,-20),Pid=pid,Start=start};
            if(!GetWindowRect(window,out w.Bounds))throw new Win32Exception();
            try {
                HideBeforeStyleChange(window);
                SetStyle(window,-16,new IntPtr((w.Style.ToInt64()|CHILD)&~(POPUP|CAPTION|THICKFRAME|VISIBLE)));
                SetStyle(window,-20,new IntPtr((w.Extended.ToInt64()|TOOLWINDOW)&~APPWINDOW));
                SetLastError(0);var previous=SetParent(window,ParentWindow);
                if(previous==IntPtr.Zero&&Marshal.GetLastWin32Error()!=0)throw new Win32Exception();
                if(GetParent(window)!=ParentWindow)throw new Exception("程序不接受窗口嵌入。");
                SetWindowPos(window,IntPtr.Zero,0,0,0,0,0x0037);
                Windows[window.ToInt64()]=w;Layout();return null;
            } catch {Windows.Remove(window.ToInt64());Restore(w);throw;}
        }
        throw new Exception("不支持的窗口操作。");
    }
    public static void Run(string parent) {
        ParentWindow=new IntPtr(Int64.Parse(parent));if(!IsWindow(ParentWindow))throw new Exception("HMM 窗口不存在。");
        try {
            // ReadLine runs off the native thread so parent loss is detected even without input.
            Task<string> line=Task.Run(()=>Console.ReadLine());
            while(IsWindow(ParentWindow)) {
                if(!line.Wait(250))continue;string raw=line.Result;if(raw==null)break;
                Dictionary<string,object> request=null;
                try {request=Json.Deserialize<Dictionary<string,object>>(raw);var value=Command(Text(request,"action"),(Dictionary<string,object>)request["payload"]);Console.WriteLine(Json.Serialize(new {id=request["id"],ok=true,value=value}));}
                catch(Exception error) {Console.WriteLine(Json.Serialize(new {id=request==null?null:request["id"],ok=false,error=error.Message}));}
                line=Task.Run(()=>Console.ReadLine());
            }
        } finally {foreach(var w in Windows.Values)try {Restore(w);}catch {} Windows.Clear();}
    }
}
