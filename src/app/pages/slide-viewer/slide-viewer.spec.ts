import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SlideViewer } from './slide-viewer';

describe('SlideViewer', () => {
  let component: SlideViewer;
  let fixture: ComponentFixture<SlideViewer>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SlideViewer]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SlideViewer);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
