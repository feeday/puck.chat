# python 图片搜索脚本
```
import tkinter as tk
from tkinter import filedialog, messagebox, ttk, Toplevel
import cv2
import numpy as np
from skimage.feature import match_template
from PIL import Image, ImageTk
import os

class ImageSearchApp:
    def __init__(self, root):
        self.root = root
        self.root.title("图像搜索应用")
        self.root.geometry("300x400")

        # 创建UI元素
        self.load_button = tk.Button(root, text="选择目标图像", command=self.load_target_image)
        self.load_button.pack(pady=10)

        self.load_folder_button = tk.Button(root, text="选择要搜索的文件夹", command=self.load_folder)
        self.load_folder_button.pack(pady=10)

        self.similarity_label = tk.Label(root, text="相似度阈值:")
        self.similarity_label.pack()
        self.similarity_scale = tk.Scale(root, from_=0, to=1, resolution=0.01, orient="horizontal")
        self.similarity_scale.set(0.66)  # 默认相似度阈值为0.66
        self.similarity_scale.pack()

        self.search_button = tk.Button(root, text="搜索相似图像", command=self.search_images)
        self.search_button.pack(pady=10)

        self.status_label = tk.Label(root, text="")
        self.status_label.pack()

        self.result_label = tk.Label(root, text="")
        self.result_label.pack()

        self.preview_label = tk.Label(root, text="预览图片:")
        self.preview_label.pack()

        self.target_image = None
        self.images_to_search = []
        self.results = []
        self.selected_result = None
        self.preview_window = None  # 初始化预览窗口为None

        self.preview_dropdown = ttk.Combobox(root, state="readonly")
        self.preview_dropdown.pack(pady=10)
        self.preview_dropdown.bind("<<ComboboxSelected>>", self.show_selected_preview)

    def load_target_image(self):
        file_path = filedialog.askopenfilename(title="选择目标图像")
        if file_path:
            self.target_image = cv2.imread(file_path, cv2.IMREAD_COLOR)
            self.status_label.config(text="目标图像加载成功")

    def load_folder(self):
        folder_path = filedialog.askdirectory(title="选择要搜索的文件夹")
        if folder_path:
            self.images_to_search = []
            for filename in os.listdir(folder_path):
                if filename.endswith(('.jpg', '.jpeg', '.png', '.bmp')):  # 根据需要修改文件类型
                    image_path = os.path.join(folder_path, filename)
                    image = cv2.imread(image_path, cv2.IMREAD_COLOR)
                    if image is not None:
                        self.images_to_search.append((image, filename))
            self.status_label.config(text=f"从文件夹加载了 {len(self.images_to_search)} 张图像")

    def search_images(self):
        if self.target_image is None:
            self.status_label.config(text="请先加载目标图像")
            return

        if not self.images_to_search:
            self.status_label.config(text="请先选择要搜索的文件夹")
            return

        similarity_threshold = self.similarity_scale.get()
        self.results = []

        for image_to_search, filename in self.images_to_search:
            result = self.search_image(self.target_image, image_to_search, similarity_threshold)
            if result:
                self.results.append(filename)

        if self.results:
            self.result_label.config(text=f"相似图片文件名: 共 {len(self.results)} 张")
            self.preview_dropdown["values"] = self.results  # 将搜到的图像名称显示在下拉列表中
            self.status_label.config(text="\n".join(self.results))
        else:
            self.result_label.config(text="未找到相似图片")
            self.preview_dropdown["values"] = []  # 清空下拉列表
            self.status_label.config(text="")

    def search_image(self, target, template, threshold):
        if template.shape[0] > target.shape[0] or template.shape[1] > target.shape[1]:
            self.status_label.config(text="模板图像大于目标图像，请重新选择")
            return False

        result = match_template(target, template)
        match_locations = np.where(result >= threshold)
        return len(match_locations[0]) > 0

    def show_selected_preview(self, event):
        selected_filename = self.preview_dropdown.get()  # 获取下拉列表中选择的相似图像名称
        if selected_filename:
            for image, filename in self.images_to_search:
                if filename == selected_filename:
                    self.preview_image(image, f"相似图片: {selected_filename}")

    def preview_image(self, image, title):
        if self.preview_window:
            self.preview_window.destroy()
        self.preview_window = Toplevel(self.root)
        self.preview_window.title(title)
        self.display_image(image, title, parent=self.preview_window)

    def display_image(self, image, title, parent=None):
        image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        image = Image.fromarray(image)
        photo = ImageTk.PhotoImage(image=image)

        if parent:
            display_label = tk.Label(parent, image=photo)
            display_label.image = photo
            display_label.pack()
        else:
            display_label = tk.Label(self.root, image=photo)
            display_label.image = photo
            display_label.pack()

        title_label = tk.Label(self.root, text=title)
        title_label.pack()

if __name__ == "__main__":
    root = tk.Tk()
    app = ImageSearchApp(root)
    root.mainloop()
```
