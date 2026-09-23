using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;
// Test-only EXEs compiled into a fresh temporary directory by smoke-program-windows.cjs.
public class ProgramWindowFixture {
    [StructLayout(LayoutKind.Sequential)] struct STYLESTRUCT { public uint Old, New; }
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr window);
    [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr window,int index);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window,out RECT rect);
    class ObservedForm : Form {
        public string DirectoryPath, FixtureName;
        protected override void WndProc(ref Message message) {
            // Observe the REAL native operation order; a queued SW_HIDE is insufficient.
            if(DirectoryPath!=null&&message.Msg==0x007C&&message.WParam.ToInt64()==-20) {
                var style=(STYLESTRUCT)Marshal.PtrToStructure(message.LParam,typeof(STYLESTRUCT));
                if((style.Old&0x00040000)!=0&&(style.New&0x00040000)==0&&IsWindowVisible(Handle))
                    File.WriteAllText(Path.Combine(DirectoryPath,FixtureName+"-visible-style-change"),"APPWINDOW removed while visible");
            }
            base.WndProc(ref message);
        }
    }
    [STAThread] public static void Main(string[] args) {
        string dir=Path.GetDirectoryName(Application.ExecutablePath),name=Path.GetFileNameWithoutExtension(Application.ExecutablePath);
        var form=new ObservedForm {DirectoryPath=dir,FixtureName=name,Text="HMM test "+name,Width=700,Height=500};
        form.Controls.Add(new TextBox {Dock=DockStyle.Top,Text="Type here after switching tabs"});
        form.FormClosing+=(sender,e)=>{if(name!="Parent"&&File.Exists(Path.Combine(dir,"refuse")))e.Cancel=true;};
        form.Shown+=(sender,e)=>{
            if(name=="Parent")File.WriteAllText(Path.Combine(dir,"parent-hwnd"),form.Handle.ToInt64().ToString());
            if(name=="First")Process.Start(new ProcessStartInfo {FileName=Path.Combine(dir,"Second.exe"),UseShellExecute=false});
        };
        var timer=new Timer {Interval=100};
        timer.Tick+=(sender,e)=>{
            if(name=="Parent"&&File.Exists(Path.Combine(dir,"move-parent"))) {form.Left+=80;form.Top+=60;File.Delete(Path.Combine(dir,"move-parent"));}
            RECT rect;GetWindowRect(form.Handle,out rect);
            string value=String.Join("|",new string[]{GetParent(form.Handle).ToInt64().ToString(),GetWindowLongPtr(form.Handle,-16).ToInt64().ToString(),GetWindowLongPtr(form.Handle,-20).ToInt64().ToString(),rect.Left.ToString(),rect.Top.ToString(),IsWindowVisible(form.Handle)?"1":"0"});
            try {File.WriteAllText(Path.Combine(dir,name+"-window-state"),value);}catch(IOException){}
        };
        timer.Start();Application.Run(form);timer.Dispose();
    }
}
