import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

interface IFeature {
  icon: string;
  title: string;
  description: string;
}


@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.scss'
})
export class Home {
  features: IFeature[] = [
    {
      icon: './images/AnnotationTools.svg',
      title: 'High-Resolution Viewing',
      description: 'Navigate gigapixel whole slide images with smooth pan and zoom at any magnification level.'
    },
    {
      icon: './images/AnnotationTools.svg',
      title: 'Annotation Tools',
      description: 'Mark regions of interest, measure distances, and add diagnostic notes directly on slides.'
    },
    {
      icon: './images/CaseManagement.svg',
      title: 'Case Management',
      description: 'Organise cases with full clinical context, specimen details, and diagnostic workflow tracking.'
    },
    {
      icon: './images/CloudStorage.svg',
      title: 'Cloud Storage',
      description: 'Securely access slides from AWS S3 or Alibaba Cloud OSS with optimised streaming.'
    }
  ];
}
